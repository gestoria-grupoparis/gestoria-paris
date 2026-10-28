import { useState } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { etiquetaEstado, SITUACIONES } from '../tramites/filtros'
import { aprobarExcepcionFondos, type Compromiso } from './consultas'

const TH = 'border-b border-linea px-2 py-1.5 text-left text-xs font-medium text-tenue whitespace-nowrap'
const TD = 'border-b border-linea px-2 py-1 whitespace-nowrap'

function DialogoExcepcion({ c, onCerrar, onGuardado }: { c: Compromiso; onCerrar: () => void; onGuardado: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function aprobar() {
    if (!motivo.trim()) return setError('Ingresá el motivo de la excepción.')
    try {
      await aprobarExcepcionFondos(c.tramite_id, motivo.trim())
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    }
  }
  return (
    <Dialogo titulo="Aprobar excepción de fondos" onCerrar={onCerrar}>
      <p className="mb-2 text-sm">{c.numero} queda habilitado para presentar aunque el disponible no alcance.</p>
      <label className={CLASE_ETIQUETA}>
        Motivo
        <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_CAMPO} />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-alerta">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
        <button type="button" onClick={aprobar} className={CLASE_PRIMARIO}>Aprobar excepción</button>
      </div>
    </Dialogo>
  )
}

/** Pestaña "Compromisos": trámites que componen el comprometido de la cuenta. */
export function TablaCompromisos({ filas, esGerencia, onCambio }: {
  filas: Compromiso[]
  esGerencia: boolean
  onCambio: () => void
}) {
  const [excepcion, setExcepcion] = useState<Compromiso | null>(null)
  if (!filas.length) return <p className="p-4 text-sm text-tenue">No hay trámites con fondos comprometidos.</p>
  return (
    <div className="overflow-x-auto border border-linea bg-white">
      <table aria-label="Compromisos" className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>Trámite</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Estado</th>
            <th className={`${TH} text-right`}>Presupuesto</th>
            <th className={`${TH} text-right`}>Pagado</th>
            <th className={`${TH} text-right`}>Comprometido</th>
            <th className={TH}>Situación</th>
            {esGerencia && <th className={TH}><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.tramite_id}>
              <td className={TD}>{c.numero}</td>
              <td className={TD}>{c.cliente}</td>
              <td className={TD}>{etiquetaEstado(c.estado)}</td>
              <td className={`${TD} text-right`}>{c.presupuesto ? formatearPesos(c.presupuesto) : '—'}</td>
              <td className={`${TD} text-right`}>{formatearPesos(c.pagado)}</td>
              <td className={`${TD} text-right font-medium`}>{formatearPesos(c.comprometido)}</td>
              <td className={`${TD} ${c.situacion === 'sin_fondos' ? 'font-medium text-alerta' : ''}`}>
                {SITUACIONES[c.situacion] ?? c.situacion}
              </td>
              {esGerencia && (
                <td className={TD}>
                  {c.situacion === 'sin_fondos' && (
                    <button type="button" onClick={() => setExcepcion(c)} className="text-xs font-medium text-marca underline">
                      Aprobar excepción
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {excepcion && (
        <DialogoExcepcion
          c={excepcion}
          onCerrar={() => setExcepcion(null)}
          onGuardado={() => {
            setExcepcion(null)
            onCambio()
          }}
        />
      )}
    </div>
  )
}
