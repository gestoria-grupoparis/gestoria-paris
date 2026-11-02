import { useState } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { etiquetaEstado, SITUACIONES } from '../tramites/filtros'
import { Button, Chip, ChipEstado, DataTable, EmptyState, IconoCheck, celdaMonto, celdaPrincipal, cx, type TonoChip } from '../../ui'
import { aprobarExcepcionFondos, type Compromiso } from './consultas'


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
      {error && <p role="alert" className="mt-3 rounded-md bg-sinfondos-suave px-3 py-2 text-sm text-sinfondos">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
        <button type="button" onClick={aprobar} className={CLASE_PRIMARIO}>Aprobar excepción</button>
      </div>
    </Dialogo>
  )
}

const TONO_SITUACION: Record<string, TonoChip> = {
  sin_fondos: 'sinfondos',
  comprometido: 'comprometido',
  pagado_parcial: 'info',
  pagado: 'disponible',
}

/** Pestaña "Compromisos": trámites que componen el comprometido de la cuenta. */
export function TablaCompromisos({ filas, esGerencia, onCambio }: {
  filas: Compromiso[]
  esGerencia: boolean
  onCambio: () => void
}) {
  const [excepcion, setExcepcion] = useState<Compromiso | null>(null)
  if (!filas.length)
    return (
      <EmptyState nivel={2}
        icono={<IconoCheck className="size-6" />}
        titulo="No hay trámites con fondos comprometidos"
        descripcion="Cuando una gestora cargue un presupuesto, el trámite aparece acá hasta que se registre el pago final."
      />
    )
  return (
    <>
      <DataTable aria-label="Compromisos">
        <thead>
          <tr>
            <th>Trámite · cliente</th>
            <th>Estado</th>
            <th className="!text-right">Presupuesto</th>
            <th className="!text-right">Pagado</th>
            <th className="!text-right">Comprometido</th>
            <th>Situación</th>
            {esGerencia && <th><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.tramite_id}>
              <td className="min-w-40 leading-tight">
                <div className={cx(celdaPrincipal, 'cifra')}>{c.numero}</div>
                <div className="text-[13px] text-tenue">{c.cliente}</div>
              </td>
              <td><ChipEstado estado={c.estado} etiqueta={etiquetaEstado(c.estado)} /></td>
              <td className={celdaMonto}>{c.presupuesto ? formatearPesos(c.presupuesto) : '—'}</td>
              <td className={celdaMonto}>{formatearPesos(c.pagado)}</td>
              <td className={cx(celdaMonto, 'font-semibold text-comprometido')}>{formatearPesos(c.comprometido)}</td>
              <td>
                <Chip tono={TONO_SITUACION[c.situacion] ?? 'neutro'}>{SITUACIONES[c.situacion] ?? c.situacion}</Chip>
              </td>
              {esGerencia && (
                <td className="text-right">
                  {c.situacion === 'sin_fondos' && (
                    <Button variante="secundario" tamano="sm" onClick={() => setExcepcion(c)}>Aprobar excepción</Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
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
    </>
  )
}
