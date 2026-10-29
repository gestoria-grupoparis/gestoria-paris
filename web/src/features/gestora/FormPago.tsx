import { useState, type FormEvent } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Dialogo } from '../tramites/Dialogo'
import { Button, claseControl, ErrorState, Field, Input } from '../../ui'
import { etiquetaEstado, hoyEnBuenosAires } from '../tramites/filtros'
import { registrarPago, type Conceptos } from './consultas'
import { CamposConceptos, CONCEPTOS_VACIOS, leerConceptos } from './FormPresupuesto'

export function FormPago({ tramite, onCerrar, onGuardado, excepcion }: {
  tramite: { id: string; numero: string; presupuesto: string | null; estado?: string }
  onCerrar: () => void
  onGuardado: () => void
  /** R24: el trámite no está autorizado ni en curso; la oficina lo registra con motivo de excepción. */
  excepcion?: boolean
}) {
  const [motivo, setMotivo] = useState('')
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
    if (excepcion && !motivo.trim()) return setError('Indicá el motivo de la excepción: por qué se pagó un trámite no autorizado.')
    setEnviando(true)
    try {
      await registrarPago(idem, tramite.id, fecha, c, esFinal, excepcion ? motivo.trim() : undefined)
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Registrar pago" rotulo={`Trámite ${tramite.numero}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="space-y-4">
        {excepcion && (
          <div className="rounded-lg bg-comprometido-suave px-4 py-3 text-[14px] text-comprometido ring-1 ring-comprometido/25">
            <strong className="block font-semibold">Pago de excepción</strong>
            <span className="text-tinta">
              El trámite está {tramite.estado ? etiquetaEstado(tramite.estado).toLowerCase() : 'fuera de curso'}. Solo se registra si el pago ya ocurrió, con el motivo.
            </span>
          </div>
        )}
        <div className="flex items-end justify-between gap-3 rounded-lg bg-noche px-4 py-3 text-superficie">
          <div>
            <div className="text-[12px] font-medium text-white/60">Presupuesto cargado</div>
            <strong data-testid="presupuesto-referencia" className="cifra mt-0.5 block font-display text-[24px] leading-tight font-semibold">
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
            <span className="block text-[14px] font-semibold">¿Es el pago final?</span>
            <span className="block text-[13px] text-tenue">Desmarcalo si vas a pagar el resto otro día.</span>
          </span>
        </label>
        {excepcion && (
          <Field label="Motivo de la excepción">
            {(p) => <textarea {...p} rows={2} className={`${claseControl} h-auto py-2.5`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Field>
        )}
        {error && <ErrorState titulo="No se pudo guardar el pago" descripcion={error} />}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variante="secundario" tamano="lg" onClick={onCerrar}>Cancelar</Button>
          <Button type="submit" tamano="lg" cargando={enviando}>Guardar pago</Button>
        </div>
      </form>
    </Dialogo>
  )
}
