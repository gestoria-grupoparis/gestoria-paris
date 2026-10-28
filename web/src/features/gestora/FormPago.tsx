import { useState, type FormEvent } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { registrarPago, type Conceptos } from './consultas'
import { CamposConceptos, CONCEPTOS_VACIOS, leerConceptos } from './FormPresupuesto'

export function FormPago({ tramite, onCerrar, onGuardado }: {
  tramite: { id: string; numero: string; presupuesto: string | null }
  onCerrar: () => void
  onGuardado: () => void
}) {
  // Una clave por apertura del formulario: un reintento no duplica el pago.
  const [idem] = useState(() => crypto.randomUUID())
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires())
  const [valor, setValor] = useState(CONCEPTOS_VACIOS)
  const [esFinal, setEsFinal] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    let c: Conceptos
    try {
      c = leerConceptos(valor)
    } catch (err) {
      return setError((err as Error).message)
    }
    setEnviando(true)
    try {
      await registrarPago(idem, tramite.id, fecha, c, esFinal)
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Registrar pago" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="flex justify-between border-l-4 border-marca bg-fondo px-3 py-2 text-sm">
          <span>Presupuesto {tramite.numero}</span>
          <strong data-testid="presupuesto-referencia">
            {tramite.presupuesto ? formatearPesos(tramite.presupuesto) : 'Sin presupuesto'}
          </strong>
        </p>
        <label className={CLASE_ETIQUETA}>
          Fecha del pago
          <input
            type="date"
            required
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={`${CLASE_CAMPO} py-2.5 text-base`}
          />
        </label>
        <CamposConceptos valor={valor} onCambio={setValor} />
        <label className="flex items-center gap-3 py-1 text-base font-medium">
          <input
            type="checkbox"
            checked={esFinal}
            onChange={(e) => setEsFinal(e.target.checked)}
            className="size-5 accent-marca"
          />
          ¿Es el pago final?
        </label>
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className={`${CLASE_SECUNDARIO} flex-1 py-3`}>Cancelar</button>
          <button type="submit" disabled={enviando} className={`${CLASE_PRIMARIO} flex-1 py-3`}>Guardar pago</button>
        </div>
      </form>
    </Dialogo>
  )
}
