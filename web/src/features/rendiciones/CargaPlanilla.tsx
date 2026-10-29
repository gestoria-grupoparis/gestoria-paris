import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { useMutacionUnica } from '../../lib/consultas'
import { Button, CampoPesos, Chip, DataTable, EmptyState, ErrorState, claseControl, cx, useAviso } from '../../ui'
import { candidatosDe, guardarFilas, type FilaParaGuardar, type RendicionDetalle, type VinculoFila } from './consultas'
import { importarPlanilla, esPlanillaArchivo } from './importarExcel'
import { leerArchivo } from './lectura'
import { combinarPlanillas, parsearPlanilla, parsearPlanillaOcr, type FilaPlanilla, type ResultadoPlanilla } from './parsers'
import { vincularFila, type Candidato } from './vincular'

interface FilaEdit {
  key: string
  id?: string
  nombre: string
  dominio: string
  pago: string
  honorarios: string
  tramite_id: string | null
  vinculo: VinculoFila
  candidatos: string[]
  /** La lectura por OCR no pudo leer algún dato con seguridad: hay que revisarla. */
  revisar?: boolean
}

const sinSigno = (cents: bigint | string | null) => cents === null ? '' : formatearPesos(cents).replace(/^-?\$ /, (m) => (m.startsWith('-') ? '-' : ''))
let n = 0
const clave = () => `f${++n}`

function centavosDe(texto: string): bigint | null {
  try {
    return parsearPesos(texto)
  } catch {
    return null
  }
}

export const ACEPTA_PLANILLA = '.xlsx,.csv,.pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/*'

export function CargaPlanilla({ rendicion, editable }: { rendicion: RendicionDetalle; editable: boolean }) {
  const qc = useQueryClient()
  const avisar = useAviso()
  const candidatos = useQuery({ queryKey: ['rendiciones', 'candidatos', rendicion.empresa_id], queryFn: () => candidatosDe(rendicion.empresa_id) })
  const [filas, setFilas] = useState<FilaEdit[]>(() =>
    rendicion.filas.map((f) => ({
      key: clave(), id: f.id, nombre: f.nombre, dominio: f.dominio ?? '', pago: sinSigno(f.pago), honorarios: sinSigno(f.honorarios),
      tramite_id: f.tramite_id, vinculo: f.vinculo, candidatos: f.candidatos,
    })))
  const [sucio, setSucio] = useState(false)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [errorLectura, setErrorLectura] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const porId = useMemo(() => new Map((candidatos.data ?? []).map((c) => [c.id, c])), [candidatos.data])

  const guardar = useMutacionUnica({
    mutationFn: (lista: FilaParaGuardar[]) => guardarFilas(rendicion.id, lista),
    onSuccess: async () => {
      setSucio(false)
      await qc.invalidateQueries({ queryKey: ['rendiciones'] })
      avisar({ texto: 'Planilla guardada.' })
    },
  })

  const importar = async (f: File) => {
    setErrorLectura(null)
    setAviso(null)
    if (f.size > 15 * 1024 * 1024) return setErrorLectura('El archivo supera los 15 MB. Dividilo o bajale la resolución.')
    setLeyendo(f.name)
    try {
      let leidas: FilaPlanilla[]
      if (esPlanillaArchivo(f.name)) leidas = await importarPlanilla(await f.arrayBuffer(), f.name)
      else {
        const paginas = await leerArchivo(f, (p) => setLeyendo(`${f.name} · página ${p.pagina} de ${p.total}${p.etapa === 'ocr' ? ` · OCR ${p.porcentaje ?? 0}%` : ''}`), 'planilla')
        const resultados: ResultadoPlanilla[] = paginas.map((p) =>
          p.lineasOcr?.length ? combinarPlanillas(p.lineasOcr.map((l) => parsearPlanillaOcr(l))) : parsearPlanilla(p.texto))
        leidas = resultados.flatMap((r) => r.filas)
        const dudosas = leidas.filter((l) => l.dudoso).length
        const avisos: string[] = []
        if (dudosas) avisos.push(`${dudosas} ${dudosas === 1 ? 'fila quedó' : 'filas quedaron'} para revisar: los importes que no se leyeron con seguridad están vacíos. Completalos mirando la planilla.`)
        if (resultados.some((r) => r.cuadra === false)) avisos.push('La suma de las filas no coincide con el total de la hoja. Revisá los importes.')
        setAviso(avisos.join(' ') || null)
      }
      if (!leidas.length) {
        setErrorLectura('No se encontraron filas con nombre, pago y honorarios. Revisá el archivo o cargalas a mano.')
        return
      }
      const cs = candidatos.data ?? []
      setFilas(leidas.map((l) => {
        const v = vincularFila(l, cs)
        return {
          key: clave(), nombre: l.nombre, dominio: l.dominio ?? '', pago: sinSigno(l.pago_cents), honorarios: sinSigno(l.honorarios_cents),
          tramite_id: v.tramite_id, vinculo: v.vinculo, candidatos: v.candidatos, revisar: l.dudoso,
        }
      }))
      setSucio(true)
    } catch (e) {
      setErrorLectura(/FORMATO_NO_SOPORTADO/.test(String((e as Error).message))
        ? 'Este navegador no puede abrir ese formato (por ejemplo HEIC). Convertilo a JPG o PDF.'
        : `No se pudo leer el archivo: ${(e as Error).message}`)
    } finally {
      setLeyendo(null)
    }
  }

  const cambiar = (key: string, cambios: Partial<FilaEdit>) => {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...cambios } : f)))
    setSucio(true)
  }

  const totales = filas.reduce(
    (t, f) => {
      const p = centavosDe(f.pago)
      const h = centavosDe(f.honorarios)
      return { pago: p === null || t.pago === null ? null : t.pago + p, hon: h === null || t.hon === null ? null : t.hon + h }
    },
    { pago: 0n as bigint | null, hon: 0n as bigint | null },
  )

  const enviar = () => {
    const lista: FilaParaGuardar[] = []
    for (const [i, f] of filas.entries()) {
      const p = centavosDe(f.pago)
      const h = centavosDe(f.honorarios)
      if (!f.nombre.trim() || p === null || h === null) {
        setErrorLectura(`Revisá la fila ${i + 1}: necesita nombre, pago y honorarios válidos.`)
        return
      }
      lista.push({
        id: f.id, nombre: f.nombre.trim(), dominio: f.dominio.trim() || null, pago_cents: p.toString(), honorarios_cents: h.toString(),
        tramite_id: f.tramite_id, vinculo: f.vinculo, candidatos: f.candidatos,
      })
    }
    setErrorLectura(null)
    guardar.mutate(lista)
  }

  const soltar = (e: DragEvent) => {
    e.preventDefault()
    setArrastrando(false)
    const f = e.dataTransfer.files[0]
    if (f) void importar(f)
  }

  return (
    <section aria-label="Planilla" className="flex flex-col gap-4">
      {editable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
          className={cx('flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-6 text-center',
            arrastrando ? 'border-acento bg-acento/5' : 'border-linea-fuerte bg-superficie')}
        >
          <p className="text-sm font-medium">Arrastrá la planilla del mes o elegila</p>
          <p className="text-[13px] text-tenue">Excel o CSV se importan tal cual; una foto o PDF se lee con OCR y conviene revisar las filas.</p>
          <input
            ref={input}
            type="file"
            accept={ACEPTA_PLANILLA}
            aria-label="Archivo de la planilla"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importar(f)
            }}
          />
          <Button variante="secundario" tamano="sm" cargando={!!leyendo} onClick={() => input.current?.click()}>Elegir archivo</Button>
          {leyendo && <p role="status" className="text-[13px] text-tenue">Leyendo {leyendo}…</p>}
        </div>
      )}
      {aviso && <p role="status" className="rounded-md bg-comprometido-suave px-4 py-3 text-sm text-comprometido">{aviso}</p>}
      {errorLectura && <ErrorState titulo="No se pudo cargar la planilla." descripcion={errorLectura} />}
      {candidatos.isError && (
        <ErrorState titulo="No se pudieron traer los trámites para vincular." descripcion={mensajeError(candidatos.error)}
          accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void candidatos.refetch()}>Reintentar</Button>} />
      )}

      {filas.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay filas."
          descripcion={editable ? 'Importá la planilla o agregá las filas a mano.' : 'La rendición no tiene planilla cargada.'}
          accion={editable ? <Button variante="secundario" tamano="sm" onClick={() => { setFilas([{ key: clave(), nombre: '', dominio: '', pago: '', honorarios: sinSigno(rendicion.honorario), tramite_id: null, vinculo: 'sin_vincular', candidatos: [] }]); setSucio(true) }}>Agregar fila</Button> : undefined}
        />
      ) : (
        <DataTable
          aria-label="Filas de la planilla"
          className="min-w-[980px]"
          pie={
            <span className="flex flex-wrap justify-between gap-2">
              <span>{filas.length} {filas.length === 1 ? 'fila' : 'filas'}</span>
              <span>
                Total pago <strong className="cifra text-tinta" data-testid="total-pago">{totales.pago === null ? '—' : formatearPesos(totales.pago)}</strong>
                {' · '}Honorarios <strong className="cifra text-tinta">{totales.hon === null ? '—' : formatearPesos(totales.hon)}</strong>
              </span>
            </span>
          }
        >
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Dominio</th>
              <th className="!text-right">Pago</th>
              <th className="!text-right">Honorarios</th>
              <th>Trámite</th>
              {editable && <th><span className="sr-only">Quitar</span></th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.key}>
                <td>
                  {editable ? (
                    <input aria-label={`Nombre fila ${i + 1}`} value={f.nombre} onChange={(e) => cambiar(f.key, { nombre: e.target.value })} className={cx(claseControl, 'h-9 min-w-56')} />
                  ) : <span className="font-medium">{f.nombre}</span>}
                  {f.revisar && <Chip tono="comprometido" className="mt-1">Revisar importes</Chip>}
                </td>
                <td>
                  {editable ? (
                    <input aria-label={`Dominio fila ${i + 1}`} value={f.dominio} onChange={(e) => cambiar(f.key, { dominio: e.target.value.toUpperCase() })} className={cx(claseControl, 'h-9 w-28 font-mono')} />
                  ) : f.dominio || '—'}
                </td>
                <td className="text-right">
                  {editable ? <CampoPesos aria-label={`Pago fila ${i + 1}`} value={f.pago} onValor={(v) => cambiar(f.key, { pago: v })} className="h-9 w-40 text-right" /> : <span className="cifra">$ {f.pago}</span>}
                </td>
                <td className="text-right">
                  {editable ? <CampoPesos aria-label={`Honorarios fila ${i + 1}`} value={f.honorarios} onValor={(v) => cambiar(f.key, { honorarios: v })} className="h-9 w-32 text-right" /> : <span className="cifra">$ {f.honorarios}</span>}
                </td>
                <td><Vinculo fila={f} n={i + 1} editable={editable} porId={porId} todos={candidatos.data ?? []} onCambiar={(c) => cambiar(f.key, c)} /></td>
                {editable && (
                  <td>
                    <Button variante="fantasma" tamano="sm" aria-label={`Quitar fila ${i + 1}`} onClick={() => { setFilas((fs) => fs.filter((x) => x.key !== f.key)); setSucio(true) }}>Quitar</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {editable && filas.length > 0 && (
        <div className="flex flex-col gap-2">
          {guardar.isError && <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">{mensajeError(guardar.error)}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variante="secundario" onClick={() => { setFilas((fs) => [...fs, { key: clave(), nombre: '', dominio: '', pago: '', honorarios: sinSigno(rendicion.honorario), tramite_id: null, vinculo: 'sin_vincular', candidatos: [] }]); setSucio(true) }}>Agregar fila</Button>
            <Button onClick={enviar} cargando={guardar.isPending} disabled={!sucio}>Guardar planilla</Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Vinculo({ fila, n, editable, porId, todos, onCambiar }: {
  fila: FilaEdit
  n: number
  editable: boolean
  porId: Map<string, Candidato>
  todos: Candidato[]
  onCambiar: (c: Partial<FilaEdit>) => void
}) {
  const t = fila.tramite_id ? porId.get(fila.tramite_id) : undefined
  const opciones = fila.vinculo === 'ambiguo' && !fila.tramite_id ? fila.candidatos.map((id) => porId.get(id)).filter((c): c is Candidato => !!c) : todos
  const elegir = (id: string) =>
    onCambiar(id ? { tramite_id: id, vinculo: 'manual' } : { tramite_id: null, vinculo: fila.candidatos.length > 1 ? 'ambiguo' : 'sin_vincular' })
  return (
    <div className="flex min-w-60 flex-col gap-1">
      {fila.tramite_id ? (
        <Chip tono="disponible">Vinculado{t ? ` · ${t.numero}` : ''}</Chip>
      ) : fila.vinculo === 'ambiguo' ? (
        <Chip tono="comprometido">Ambiguo · {fila.candidatos.length} posibles</Chip>
      ) : (
        <Chip tono="sinfondos">Sin vincular</Chip>
      )}
      {t && !t.autorizado && <span className="text-[12px] text-sinfondos">El trámite no está autorizado.</span>}
      {editable && (
        <select aria-label={`Trámite fila ${n}`} value={fila.tramite_id ?? ''} onChange={(e) => elegir(e.target.value)} className={cx(claseControl, 'h-9 text-[13px]')}>
          <option value="">{fila.vinculo === 'ambiguo' ? 'Elegí entre los posibles…' : 'Buscar trámite…'}</option>
          {(fila.tramite_id && !opciones.some((o) => o.id === fila.tramite_id) && t ? [t, ...opciones] : opciones).map((c) => (
            <option key={c.id} value={c.id}>{c.numero} · {c.cliente}{c.dominio ? ` · ${c.dominio}` : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}
