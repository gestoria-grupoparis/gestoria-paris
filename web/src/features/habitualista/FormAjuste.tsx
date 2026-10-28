import { useState, type FormEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { registrarAjuste } from './consultas'

/** Ajuste de saldo con signo (solo gerencia). Pide confirmación explícita antes de enviar. */
export function FormAjuste({ empresa, onCerrar, onGuardado }: {
  empresa: { id: string; nombre: string }
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [idem] = useState(() => crypto.randomUUID())
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires())
  const [motivo, setMotivo] = useState('')
  const [aConfirmar, setAConfirmar] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  function revisar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    let cents: bigint
    try {
      cents = parsearPesos(importe)
    } catch (err) {
      return setError((err as Error).message)
    }
    if (cents === 0n) return setError('El ajuste no puede ser cero. Usá un importe negativo para restar.')
    if (!motivo.trim()) return setError('Ingresá el motivo del ajuste.')
    setAConfirmar(cents)
  }

  async function confirmar() {
    if (aConfirmar == null) return
    setEnviando(true)
    try {
      await registrarAjuste(idem, empresa.id, aConfirmar, fecha, motivo.trim())
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
      setAConfirmar(null)
    } finally {
      setEnviando(false)
    }
  }

  const bloqueado = aConfirmar != null
  return (
    <Dialogo titulo="Ajuste de saldo" onCerrar={onCerrar}>
      <form onSubmit={revisar} className="space-y-3">
        <label className={CLASE_ETIQUETA}>
          Importe (negativo para restar)
          <input inputMode="decimal" required value={importe} disabled={bloqueado}
            onChange={(e) => setImporte(e.target.value)} placeholder="-1.500,00" className={CLASE_CAMPO} />
        </label>
        <label className={CLASE_ETIQUETA}>
          Fecha
          <input type="date" required value={fecha} disabled={bloqueado}
            onChange={(e) => setFecha(e.target.value)} className={CLASE_CAMPO} />
        </label>
        <label className={CLASE_ETIQUETA}>
          Motivo
          <textarea rows={2} value={motivo} disabled={bloqueado}
            onChange={(e) => setMotivo(e.target.value)} className={CLASE_CAMPO} />
        </label>
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        {bloqueado ? (
          <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm">
            <p>
              Vas a ajustar el saldo de {empresa.nombre} en <strong>{formatearPesos(aConfirmar)}</strong>. Queda registrado
              con tu usuario y no se puede borrar.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setAConfirmar(null)} className={CLASE_SECUNDARIO}>Volver</button>
              <button type="button" onClick={confirmar} disabled={enviando} className={CLASE_PRIMARIO}>Confirmar ajuste</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
            <button type="submit" className={CLASE_PRIMARIO}>Revisar ajuste</button>
          </div>
        )}
      </form>
    </Dialogo>
  )
}
