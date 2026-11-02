import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Button, Chip, EmptyState, ErrorState, cx } from '../../ui'
import {
  candidatosDe, duplicados, guardarComprobante, subirComprobante, type ComprobanteGuardado, type RendicionDetalle,
} from './consultas'
import { hashArchivo, leerArchivo } from './lectura'
import { combinarLecturas, extraer } from './parsers'
import { RevisionComprobante, ETIQUETA_TIPO, VisorDocumento } from './RevisionComprobante'
import { asignarComprobante, type FilaAsignable } from './vincular'

const MAX_BYTES = 15 * 1024 * 1024
const ACEPTA = '.pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*'

interface EnCola {
  id: number
  nombre: string
  estado: 'leyendo' | 'listo' | 'error'
  detalle: string
  pct: number
}

let secuencia = 0

export function CargaComprobantes({ rendicion, editable, filaFoco }: { rendicion: RendicionDetalle; editable: boolean; filaFoco: string | null }) {
  const qc = useQueryClient()
  const r = rendicion
  const [foco, setFoco] = useState(filaFoco)
  const [cola, setCola] = useState<EnCola[]>([])
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const candidatos = useQuery({ queryKey: ['rendiciones', 'candidatos', r.empresa_id], queryFn: () => candidatosDe(r.empresa_id) })
  const dups = useQuery({ queryKey: ['rendiciones', 'duplicados', r.id, r.comprobantes.length], queryFn: () => duplicados(r.id) })

  const visibles = foco ? r.comprobantes.filter((c) => c.fila_id === foco) : r.comprobantes
  const actual = r.comprobantes.find((c) => c.id === seleccion) ?? null
  const nombreFila = useMemo(() => new Map(r.filas.map((f) => [f.id, f.nombre])), [r.filas])
  const dupDe = (id: string) => (dups.data ?? []).filter((d) => d.comprobante_id === id)

  useEffect(() => {
    if (!seleccion && visibles.length) setSeleccion((visibles.find((c) => c.revision === 'pendiente') ?? visibles[0]).id)
  }, [seleccion, visibles])

  // Para asignar: el dominio de la fila o, si no tiene, el del trámite vinculado; el DNI de un comprobante ya confirmado.
  const asignables = (): FilaAsignable[] => {
    const tramites = new Map((candidatos.data ?? []).map((t) => [t.id, t]))
    return r.filas.map((f) => ({
      id: f.id, nombre: f.nombre,
      dominio: f.dominio ?? (f.tramite_id ? tramites.get(f.tramite_id)?.dominio ?? null : null),
      documento: r.comprobantes.find((c) => c.fila_id === f.id && c.revision === 'confirmado' && c.documento)?.documento ?? null,
    }))
  }

  const actualizar = (id: number, cambios: Partial<EnCola>) => setCola((cs) => cs.map((c) => (c.id === id ? { ...c, ...cambios } : c)))

  const procesar = async (archivos: File[]) => {
    const items = archivos.map((f) => ({ f, item: { id: ++secuencia, nombre: f.name, estado: 'leyendo' as const, detalle: 'En espera', pct: 0 } }))
    setCola((cs) => [...items.map((x) => x.item), ...cs])
    const filas = asignables()
    for (const { f, item } of items) {
      if (f.size > MAX_BYTES) {
        actualizar(item.id, { estado: 'error', detalle: 'Supera los 15 MB: dividilo o bajale la resolución.' })
        continue
      }
      try {
        actualizar(item.id, { detalle: 'Calculando huella…' })
        const hash = await hashArchivo(f)
        actualizar(item.id, { detalle: 'Subiendo el original…' })
        const path = await subirComprobante(r.id, f, hash)
        let paginas: { pagina: number; texto: string; origen: string; confianza: number | null; lecturas?: string[] }[]
        try {
          paginas = await leerArchivo(f, (p) => actualizar(item.id, {
            detalle: p.etapa === 'ocr' ? `Leyendo página ${p.pagina} de ${p.total} · OCR ${p.porcentaje ?? 0}%` : `Leyendo página ${p.pagina} de ${p.total}`,
            pct: Math.round(((p.pagina - 1 + (p.etapa === 'ocr' ? (p.porcentaje ?? 0) / 100 : 0.5)) / p.total) * 100),
          }))
        } catch {
          // Ilegible o formato no soportado: queda como "otro" para completar a mano.
          paginas = [{ pagina: 1, texto: '', origen: 'ocr', confianza: null }]
        }
        for (const p of paginas) {
          const e = combinarLecturas((p.lecturas?.length ? p.lecturas : [p.texto]).map(extraer))
          await guardarComprobante(r.id, {
            fila_id: asignarComprobante(e, filas), tipo: e.tipo, archivo_path: path, archivo_sha256: hash, pagina: p.pagina,
            numero: e.numero, emisor: e.emisor, emisor_cuit: e.emisor_cuit, fecha: e.fecha,
            total_cents: e.total_cents?.toString() ?? null, dominio: e.dominio, documento: e.documento,
            datos_extraidos: { dudosos: e.dudosos, nombre: e.nombre, origen: p.origen, confianza: p.confianza, archivo: f.name },
            revision: 'pendiente',
            lineas: e.lineas.map((l) => ({ concepto: l.concepto, importe_cents: l.importe_cents.toString() })),
          })
        }
        actualizar(item.id, { estado: 'listo', pct: 100, detalle: `${paginas.length} ${paginas.length === 1 ? 'página leída' : 'páginas leídas'}` })
      } catch (e) {
        actualizar(item.id, { estado: 'error', detalle: mensajeError(e) })
      }
      await qc.invalidateQueries({ queryKey: ['rendiciones'] })
    }
  }

  const siguientePendiente = () => {
    const i = visibles.findIndex((c) => c.id === seleccion)
    const resto = [...visibles.slice(i + 1), ...visibles.slice(0, Math.max(0, i))]
    return resto.find((c) => c.revision === 'pendiente')?.id ?? seleccion
  }

  const soltar = (e: DragEvent) => {
    e.preventDefault()
    setArrastrando(false)
    if (e.dataTransfer.files.length) void procesar(Array.from(e.dataTransfer.files))
  }

  return (
    <section aria-label="Comprobantes" className="flex flex-col gap-4">
      {editable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
          className={cx('flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-6 text-center', arrastrando ? 'border-acento bg-acento/5' : 'border-linea-fuerte bg-superficie')}
        >
          <p className="text-sm font-medium">Arrastrá los comprobantes (PDF o fotos), de a muchos</p>
          <p className="text-[13px] text-tenue">Se leen en tu navegador, se asignan a su fila y quedan pendientes de revisión. Máximo 15 MB por archivo.</p>
          <input ref={input} type="file" multiple accept={ACEPTA} aria-label="Archivos de comprobantes" className="sr-only"
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void procesar(fs) }} />
          <Button variante="secundario" tamano="sm" onClick={() => input.current?.click()}>Elegir archivos</Button>
        </div>
      )}

      {cola.length > 0 && (
        <ul aria-label="Archivos en proceso" className="flex flex-col gap-2">
          {cola.map((c) => (
            <li key={c.id} className="rounded-md bg-superficie px-3 py-2 ring-1 ring-linea">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate font-medium">{c.nombre}</span>
                <span className={cx(c.estado === 'error' ? 'text-sinfondos' : 'text-tenue')}>{c.detalle}</span>
              </div>
              <div role="progressbar" aria-label={`Progreso de ${c.nombre}`} aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1 rounded-full bg-hundido">
                <div className={cx('h-1 rounded-full', c.estado === 'error' ? 'bg-sinfondos' : 'bg-acento')} style={{ width: `${c.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {foco && (
        <p className="text-[13px] text-tenue">
          Mostrando los comprobantes de {nombreFila.get(foco) ?? 'una fila'}.{' '}
          <button type="button" className="underline" onClick={() => setFoco(null)}>Ver todos</button>
        </p>
      )}
      {dups.isError && <ErrorState titulo="No se pudo revisar si hay duplicados." descripcion={mensajeError(dups.error)} />}

      {visibles.length === 0 ? (
        <EmptyState nivel={2} titulo="Todavía no hay comprobantes." descripcion={editable ? 'Subí los recibos, retenciones y facturas del mes.' : 'Esta rendición no tiene comprobantes.'} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul aria-label="Lista de comprobantes" className="flex max-h-[70dvh] flex-col gap-1.5 overflow-auto">
            {visibles.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === seleccion || undefined}
                  onClick={() => setSeleccion(c.id)}
                  className={cx('flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left ring-1', c.id === seleccion ? 'bg-acento/5 ring-acento' : 'bg-superficie ring-linea hover:bg-hover')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{ETIQUETA_TIPO[c.tipo]}{c.numero ? ` ${c.numero}` : ''}</span>
                    <Chip tono={c.revision === 'confirmado' ? 'disponible' : 'comprometido'}>{c.revision === 'confirmado' ? 'Confirmado' : 'Pendiente'}</Chip>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[12px] text-tenue">
                    <span className="truncate">{c.fila_id ? nombreFila.get(c.fila_id) : 'Sin asignar'}</span>
                    <span className="cifra">{c.total ? formatearPesos(c.total) : '—'}</span>
                  </span>
                  {dupDe(c.id).length > 0 && <span className="text-[12px] font-semibold text-comprometido">Posible duplicado</span>}
                </button>
              </li>
            ))}
          </ul>
          {actual && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="flex flex-col gap-2">
                {dupDe(actual.id).map((d) => (
                  <div key={d.otro_id + d.motivo} role="alert" className="rounded-md bg-comprometido-suave px-3 py-2 text-[13px] text-comprometido ring-1 ring-comprometido/25">
                    Posible duplicado: {d.motivo === 'mismo_archivo' ? 'el mismo archivo ya se cargó' : 'otro comprobante tiene el mismo tipo, número y emisor'}
                    {d.otra_rendicion === r.id ? (
                      <> · <button type="button" className="font-semibold underline" onClick={() => setSeleccion(d.otro_id)}>Ver el otro</button></>
                    ) : ' en otra rendición'}.
                  </div>
                ))}
                <VisorDocumento url={actual.url} nombre={String(actual.datos_extraidos && 'archivo' in actual.datos_extraidos ? (actual.datos_extraidos as { archivo?: string }).archivo ?? actual.archivo_path ?? '' : actual.archivo_path ?? '')} />
              </div>
              <RevisionComprobante
                key={actual.id + actual.revision}
                rendicion={r.id}
                comprobante={actual}
                filas={r.filas}
                editable={editable}
                onListo={async () => {
                  const sig = siguientePendiente()
                  await qc.invalidateQueries({ queryKey: ['rendiciones'] })
                  setSeleccion(sig)
                }}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export type { ComprobanteGuardado }
