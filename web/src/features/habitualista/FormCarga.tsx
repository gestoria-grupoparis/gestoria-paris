import { useState, type FormEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { useAviso } from '../../ui'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { registrarCarga } from './consultas'

export function FormCarga({ empresa, onCerrar, onGuardado }: {
  empresa: { id: string; nombre: string }
  onCerrar: () => void
  onGuardado: () => void
}) {
  // Una clave por apertura del formulario: un reintento no duplica la carga.
  const [idem] = useState(() => crypto.randomUUID())
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires())
  const [nota, setNota] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const avisar = useAviso()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    let cents: bigint
    try {
      cents = parsearPesos(importe)
    } catch (err) {
      return setError((err as Error).message)
    }
    if (cents <= 0n) return setError('El importe de la carga tiene que ser mayor a cero.')
    setEnviando(true)
    try {
      await registrarCarga(idem, empresa.id, cents, fecha, nota)
      avisar({ texto: `Carga de ${formatearPesos(cents.toString())} registrada` })
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Registrar carga" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-3">
        <p className="text-sm text-tenue">Fondos acreditados en la Habitualista de {empresa.nombre}.</p>
        <label className={CLASE_ETIQUETA}>
          Importe
          <input inputMode="decimal" required value={importe} onChange={(e) => setImporte(e.target.value)}
            placeholder="500.000,00" className={CLASE_CAMPO} />
        </label>
        <label className={CLASE_ETIQUETA}>
          Fecha de la carga
          <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_CAMPO} />
        </label>
        <label className={CLASE_ETIQUETA}>
          Nota (opcional)
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={CLASE_CAMPO} />
        </label>
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className={CLASE_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={enviando} className={CLASE_PRIMARIO}>Guardar carga</button>
        </div>
      </form>
    </Dialogo>
  )
}
