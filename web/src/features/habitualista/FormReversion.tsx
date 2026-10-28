import { useState, type FormEvent } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { revertirMovimiento, TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

/** Reversión (caso G): el diálogo es la confirmación explícita y exige motivo. */
export function FormReversion({ movimiento: m, onCerrar, onGuardado }: {
  movimiento: Movimiento
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [idem] = useState(() => crypto.randomUUID())
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!motivo.trim()) return setError('Ingresá el motivo de la reversión.')
    setEnviando(true)
    try {
      await revertirMovimiento(idem, m.movimiento_id, motivo.trim())
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  const importe = m.ingreso !== '0' ? m.ingreso : m.egreso
  return (
    <Dialogo titulo="Revertir movimiento" onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="space-y-3">
        <p className="border-l-4 border-marca bg-fondo px-3 py-2 text-sm">
          {TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo} del {fechaOperativa(m.fecha_operacion)}
          {m.tramite_numero ? ` (${m.tramite_numero})` : ''} por <strong>{formatearPesos(importe)}</strong>. Se registra el
          movimiento inverso; el original queda en el extracto.
        </p>
        <label className={CLASE_ETIQUETA}>
          Motivo
          <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_CAMPO} />
        </label>
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={enviando} className={CLASE_PRIMARIO}>Confirmar reversión</button>
        </div>
      </form>
    </Dialogo>
  )
}
