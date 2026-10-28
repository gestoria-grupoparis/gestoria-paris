import { useState, type FormEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { nuevaIdem } from '../../lib/supabase'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { registrarConciliacion, TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

/** Conciliación simple: saldo que muestra la Habitualista a una fecha y movimientos verificados. */
export function FormConciliacion({ empresa, pendientes, cargando = false, onCerrar, onGuardado }: {
  empresa: { id: string; nombre: string }
  pendientes: Movimiento[]
  /** Mientras se traen los pendientes (de todas las páginas del extracto). */
  cargando?: boolean
  onCerrar: () => void
  onGuardado: () => void
}) {
  // Una clave por apertura del formulario: un doble envío reusa la misma conciliación.
  const [idem] = useState(() => nuevaIdem())
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
      await registrarConciliacion(idem, empresa.id, fecha, cents, nota, verificados)
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Conciliar" rotulo={empresa.nombre} onCerrar={onCerrar} ancho="md:max-w-2xl">
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-tenue">
          Abrí el extracto de la Habitualista, anotá el saldo que muestra a la fecha de corte y tildá los movimientos que ya figuran ahí.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          {cargando ? (
            <p role="status" className="mt-2 text-sm text-tenue">Buscando movimientos pendientes…</p>
          ) : candidatos.length ? (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-md bg-superficie text-sm ring-1 ring-linea">
              {candidatos.map((m) => (
                <li key={m.movimiento_id} className="border-b border-linea last:border-0">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-marca-suave/50">
                    <input type="checkbox" checked={marcados.has(m.movimiento_id)}
                      onChange={() => alternar(m.movimiento_id)} className="size-4 accent-marca" />
                    <span className="cifra w-20 text-tenue">{fechaOperativa(m.fecha_operacion)}</span>
                    <span className="flex-1 font-medium">
                      {TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo} {m.tramite_numero ?? ''}
                    </span>
                    <span className={`cifra whitespace-nowrap font-semibold ${m.ingreso !== '0' ? 'text-disponible' : ''}`}>{m.ingreso !== '0' ? formatearPesos(m.ingreso) : `-${formatearPesos(m.egreso)}`}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-md bg-hundido px-3 py-2 text-sm text-tenue">No hay movimientos pendientes hasta esa fecha.</p>
          )}
        </fieldset>
        <label className={CLASE_ETIQUETA}>
          Nota (opcional)
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={CLASE_CAMPO} />
        </label>
        {error && <p role="alert" className="rounded-md bg-sinfondos-suave px-3 py-2 text-sm text-sinfondos">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={enviando} className={CLASE_PRIMARIO}>Guardar conciliación</button>
        </div>
      </form>
    </Dialogo>
  )
}
