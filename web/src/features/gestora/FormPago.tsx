import { useState, type FormEvent } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Dialogo } from '../tramites/Dialogo'
import { Button, ErrorState, Field, Input } from '../../ui'
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
    <Dialogo titulo="Registrar pago" rotulo={`Trámite ${tramite.numero}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="flex items-end justify-between gap-3 rounded-lg bg-noche px-4 py-3 text-superficie">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-laton uppercase">Presupuesto cargado</div>
            <strong data-testid="presupuesto-referencia" className="cifra mt-0.5 block font-display text-[24px] leading-tight font-extrabold">
              {tramite.presupuesto ? formatearPesos(tramite.presupuesto) : 'Sin presupuesto'}
            </strong>
          </div>
          <span className="pb-1 text-[12px] text-superficie/70">Referencia</span>
        </div>
        <Field label="Fecha del pago">
          {(p) => <Input {...p} type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-12" />}
        </Field>
        <CamposConceptos valor={valor} onCambio={setValor} />
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-4 py-3 ring-1 ring-linea has-[:checked]:bg-marca-suave has-[:checked]:ring-marca/40">
          <input
            type="checkbox"
            checked={esFinal}
            onChange={(e) => setEsFinal(e.target.checked)}
            className="size-5 accent-marca"
          />
          <span>
            <span className="block text-[15px] font-semibold">¿Es el pago final?</span>
            <span className="block text-[13px] text-tenue">Desmarcalo si vas a pagar el resto otro día.</span>
          </span>
        </label>
        {error && <ErrorState titulo="No se pudo guardar el pago" descripcion={error} />}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variante="secundario" tamano="lg" onClick={onCerrar}>Cancelar</Button>
          <Button type="submit" tamano="lg" cargando={enviando}>Guardar pago</Button>
        </div>
      </form>
    </Dialogo>
  )
}
