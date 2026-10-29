import { useState, type ReactNode } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { useMutacionUnica } from '../../lib/consultas'
import { Button, CampoPesos, Chip, claseControl, cx } from '../../ui'
import { esPdf } from './lectura'
import {
  guardarComprobante, type ComprobanteGuardado, type FilaGuardada, type TipoGuardado,
} from './consultas'

export const ETIQUETA_TIPO: Record<TipoGuardado, string> = {
  recibo_dnrpa: 'Recibo DNRPA',
  retencion_sellos: 'Retención de Sellos',
  factura_honorarios: 'Factura de honorarios',
  factura_electronica: 'Factura electrónica',
  otro: 'Otro comprobante',
}

const pesosEdit = (cents: string | null) => (cents == null ? '' : formatearPesos(cents).replace(/^(-?)\$ /, '$1'))

function centavos(texto: string): string | null | undefined {
  if (!texto.trim()) return null
  try {
    return parsearPesos(texto).toString()
  } catch {
    return undefined
  }
}

/** Campo de la revisión: borde ámbar y "Revisar" si el lector lo dejó dudoso o vacío. */
function Campo({ etiqueta, revisar, children }: { etiqueta: string; revisar: boolean; children: (clase: string) => ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
        {etiqueta}
        {revisar && <span className="text-[12px] font-semibold text-comprometido">Revisar</span>}
      </span>
      {children(cx(claseControl, revisar && 'border-comprometido ring-1 ring-comprometido/40'))}
    </label>
  )
}

export function VisorDocumento({ url, nombre }: { url: string | null; nombre: string }) {
  const [zoom, setZoom] = useState(1)
  if (!url) return <div className="grid h-64 place-items-center rounded-lg bg-hundido text-sm text-tenue">Sin vista previa del archivo.</div>
  const pdf = /\.pdf(\?|$)/i.test(url) || esPdf({ name: nombre, type: '' } as File)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1" role="group" aria-label="Zoom">
        <Button variante="secundario" tamano="sm" aria-label="Alejar" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</Button>
        <span className="cifra w-14 text-center text-[13px]">{Math.round(zoom * 100)}%</span>
        <Button variante="secundario" tamano="sm" aria-label="Acercar" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</Button>
      </div>
      <div className="h-[60dvh] overflow-auto rounded-lg bg-hundido ring-1 ring-linea">
        {pdf ? (
          <iframe title={`Documento ${nombre}`} src={url} className="h-full w-full" style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }} />
        ) : (
          <img src={url} alt={`Documento ${nombre}`} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />
        )}
      </div>
    </div>
  )
}

export function RevisionComprobante({ rendicion, comprobante, filas, editable, onListo }: {
  rendicion: string
  comprobante: ComprobanteGuardado
  filas: FilaGuardada[]
  editable: boolean
  onListo: () => void
}) {
  const c = comprobante
  const dudosos = new Set(c.datos_extraidos?.dudosos ?? [])
  const [tipo, setTipo] = useState<TipoGuardado>(c.tipo)
  const [numero, setNumero] = useState(c.numero ?? '')
  const [fecha, setFecha] = useState(c.fecha ?? '')
  const [emisor, setEmisor] = useState(c.emisor ?? '')
  const [total, setTotal] = useState(pesosEdit(c.total))
  const [dominio, setDominio] = useState(c.dominio ?? '')
  const [fila, setFila] = useState(c.fila_id ?? '')
  const [lineas, setLineas] = useState(c.lineas.map((l) => ({ concepto: l.concepto, importe: pesosEdit(l.importe) })))
  const [error, setError] = useState<string | null>(null)
  const revisar = (campo: string, valor: string) => c.revision === 'pendiente' && (dudosos.has(campo) || !valor.trim())

  const confirmar = useMutacionUnica({
    mutationFn: () => {
      const totalC = centavos(total)
      const ls = lineas.filter((l) => l.concepto.trim() || l.importe.trim()).map((l) => ({ concepto: l.concepto.trim(), importe_cents: centavos(l.importe) }))
      if (totalC === undefined || ls.some((l) => !l.concepto || l.importe_cents == null))
        throw new Error('DATO_INVALIDO: revisá el total y que cada línea tenga concepto e importe válido')
      return guardarComprobante(rendicion, {
        id: c.id, fila_id: fila || null, tipo, numero: numero.trim() || null, emisor: emisor.trim() || null,
        emisor_cuit: c.emisor_cuit, fecha: fecha || null, total_cents: totalC, dominio: dominio.trim() || null,
        documento: c.documento, revision: 'confirmado', lineas: ls as { concepto: string; importe_cents: string }[],
      })
    },
    onSuccess: () => {
      setError(null)
      onListo()
    },
    onError: (e) => setError(mensajeError(e)),
  })

  const deshabilitado = !editable || confirmar.isPending
  return (
    <form
      aria-label="Datos del comprobante"
      className="flex flex-col gap-3"
      onSubmit={(e) => { e.preventDefault(); if (editable) confirmar.mutate() }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tono={c.revision === 'confirmado' ? 'disponible' : 'comprometido'}>{c.revision === 'confirmado' ? 'Confirmado' : 'Pendiente de revisión'}</Chip>
        {c.datos_extraidos?.origen && (
          <span className="text-[12px] text-tenue">
            Leído {c.datos_extraidos.origen === 'texto_pdf' ? 'del texto del PDF' : 'con OCR'}{c.datos_extraidos.confianza != null ? ` · confianza ${Math.round(c.datos_extraidos.confianza)}%` : ''} · página {c.pagina}
          </span>
        )}
      </div>
      <fieldset disabled={deshabilitado} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo" revisar={c.revision === 'pendiente' && tipo === 'otro'}>
          {(cl) => (
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoGuardado)} className={cl}>
              {Object.entries(ETIQUETA_TIPO).map(([v, et]) => <option key={v} value={v}>{et}</option>)}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Número" revisar={revisar('numero', numero)}>
          {(cl) => <input value={numero} onChange={(e) => setNumero(e.target.value)} className={cl} />}
        </Campo>
        <Campo etiqueta="Fecha" revisar={revisar('fecha', fecha)}>
          {(cl) => <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={cl} />}
        </Campo>
        <Campo etiqueta="Emisor" revisar={revisar('emisor', emisor) && tipo !== 'retencion_sellos'}>
          {(cl) => <input value={emisor} onChange={(e) => setEmisor(e.target.value)} className={cl} />}
        </Campo>
        <Campo etiqueta="Total" revisar={revisar('total', total)}>
          {(cl) => <CampoPesos value={total} onValor={setTotal} className={cl} />}
        </Campo>
        <Campo etiqueta="Dominio" revisar={revisar('dominio', dominio) && tipo !== 'factura_honorarios'}>
          {(cl) => <input value={dominio} onChange={(e) => setDominio(e.target.value.toUpperCase())} className={cx(cl, 'font-mono')} />}
        </Campo>
        <Campo etiqueta="Fila de la planilla" revisar={c.revision === 'pendiente' && !fila}>
          {(cl) => (
            <select value={fila} onChange={(e) => setFila(e.target.value)} className={cl}>
              <option value="">Sin asignar</option>
              {filas.map((f) => <option key={f.id} value={f.id}>{f.nombre}{f.dominio ? ` · ${f.dominio}` : ''}</option>)}
            </select>
          )}
        </Campo>
      </fieldset>

      <fieldset disabled={deshabilitado} className={cx('flex flex-col gap-2 rounded-lg p-3 ring-1', c.revision === 'pendiente' && dudosos.has('lineas') ? 'ring-comprometido/50' : 'ring-linea')}>
        <legend className="px-1 text-[13px] font-medium">
          Líneas {c.revision === 'pendiente' && dudosos.has('lineas') && <span className="font-semibold text-comprometido">· Revisar: no suman el total</span>}
        </legend>
        {lineas.length === 0 && <p className="text-[13px] text-tenue">Sin líneas.</p>}
        {lineas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={`Concepto línea ${i + 1}`} value={l.concepto} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, concepto: e.target.value } : x)))} className={cx(claseControl, 'h-9 min-w-0 flex-1')} />
            <CampoPesos aria-label={`Importe línea ${i + 1}`} value={l.importe} onValor={(v) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, importe: v } : x)))} className="h-9 w-36 text-right" />
            {editable && <Button variante="fantasma" tamano="sm" aria-label={`Quitar línea ${i + 1}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>×</Button>}
          </div>
        ))}
        {editable && <Button variante="fantasma" tamano="sm" className="self-start" onClick={() => setLineas((ls) => [...ls, { concepto: '', importe: '' }])}>Agregar línea</Button>}
      </fieldset>

      {error && <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">{error}</p>}
      {editable && (
        <div className="flex items-center justify-between gap-2">
          <span className="hidden text-[12px] text-tenue md:block">Enter confirma y pasa al siguiente pendiente.</span>
          <Button type="submit" cargando={confirmar.isPending}>Confirmar</Button>
        </div>
      )}
    </form>
  )
}
