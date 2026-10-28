import { useState, type FormEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { registrarConciliacion, TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

/** Conciliación simple: saldo que muestra la Habitualista a una fecha y movimientos verificados. */
export function FormConciliacion({ empresa, pendientes, onCerrar, onGuardado }: {
  empresa: { id: string; nombre: string }
  pendientes: Movimiento[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires())
  const [saldo, setSaldo] = useState('')
  const [nota, setNota] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const candidatos = pendientes.filter((m) => m.fecha_operacion <= fecha)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    let cents: bigint
    try {
      cents = parsearPesos(saldo)
    } catch (err) {
      return setError((err as Error).message)
    }
    setEnviando(true)
    try {
      const verificados = candidatos.filter((m) => marcados.has(m.movimiento_id)).map((m) => m.movimiento_id)
      await registrarConciliacion(empresa.id, fecha, cents, nota, verificados)
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Conciliar" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className={CLASE_ETIQUETA}>
            Fecha de corte
            <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_CAMPO} />
          </label>
          <label className={CLASE_ETIQUETA}>
            Saldo en la Habitualista
            <input inputMode="decimal" required value={saldo} onChange={(e) => setSaldo(e.target.value)} className={CLASE_CAMPO} />
          </label>
        </div>
        <fieldset>
          <legend className={CLASE_ETIQUETA}>Movimientos pendientes que figuran en el extracto de {empresa.nombre}</legend>
          {candidatos.length ? (
            <ul className="mt-1 max-h-48 overflow-y-auto border border-linea text-sm">
              {candidatos.map((m) => (
                <li key={m.movimiento_id} className="border-b border-linea last:border-0">
                  <label className="flex items-center gap-2 px-2 py-1">
                    <input type="checkbox" checked={marcados.has(m.movimiento_id)}
                      onChange={() => alternar(m.movimiento_id)} className="accent-marca" />
                    <span className="flex-1">
                      {fechaOperativa(m.fecha_operacion)} {TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo} {m.tramite_numero ?? ''}
                    </span>
                    <span>{m.ingreso !== '0' ? formatearPesos(m.ingreso) : `-${formatearPesos(m.egreso)}`}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-tenue">No hay movimientos pendientes hasta esa fecha.</p>
          )}
        </fieldset>
        <label className={CLASE_ETIQUETA}>
          Nota (opcional)
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={CLASE_CAMPO} />
        </label>
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={enviando} className={CLASE_PRIMARIO}>Guardar conciliación</button>
        </div>
      </form>
    </Dialogo>
  )
}
