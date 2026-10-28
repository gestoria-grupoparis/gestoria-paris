import { useState, type FormEvent } from 'react'
import { parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Dialogo } from '../tramites/Dialogo'
import { Button, ErrorState, Field, Input } from '../../ui'
import { registrarPresupuesto, type Conceptos } from './consultas'

const CONCEPTOS = [
  { id: 'arancel', etiqueta: 'Arancel' },
  { id: 'prenda', etiqueta: 'Prenda' },
  { id: 'sellado', etiqueta: 'Sellados' },
  { id: 'otros', etiqueta: 'Otros' },
] as const

export type TextoConceptos = Record<keyof Conceptos, string>
export const CONCEPTOS_VACIOS: TextoConceptos = { arancel: '', prenda: '', sellado: '', otros: '' }

/** Convierte lo tipeado a centavos; un campo vacío vale cero. Lanza Error con mensaje legible. */
export function leerConceptos(v: TextoConceptos): Conceptos {
  const leer = (s: string) => (s.trim() ? parsearPesos(s) : 0n)
  return { arancel: leer(v.arancel), prenda: leer(v.prenda), sellado: leer(v.sellado), otros: leer(v.otros) }
}

export function CamposConceptos({ valor, onCambio }: { valor: TextoConceptos; onCambio: (v: TextoConceptos) => void }) {
  return (
    <fieldset className="rounded-lg bg-fondo p-4 ring-1 ring-linea">
      <legend className="rotulo float-left mb-3 w-full">Conceptos en pesos</legend>
      <div className="clear-both grid grid-cols-2 gap-3">
        {CONCEPTOS.map((c) => (
          <Field key={c.id} label={c.etiqueta}>
            {(p) => (
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tenue">$</span>
                <Input
                  {...p}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={valor[c.id]}
                  onChange={(e) => onCambio({ ...valor, [c.id]: e.target.value })}
                  className="cifra h-12 pl-7 text-right text-[17px] font-semibold"
                />
              </div>
            )}
          </Field>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-tenue">Dejá en blanco lo que no corresponda. El total lo calcula el sistema.</p>
    </fieldset>
  )
}

export function FormPresupuesto({ tramite, onCerrar, onGuardado }: {
  tramite: { id: string; numero: string }
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [valor, setValor] = useState(CONCEPTOS_VACIOS)
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
      await registrarPresupuesto(tramite.id, c)
      onGuardado()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo="Cargar presupuesto" rotulo={`Trámite ${tramite.numero}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <CamposConceptos valor={valor} onCambio={setValor} />
        {error && <ErrorState titulo="Revisá los importes" descripcion={error} />}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variante="secundario" tamano="lg" onClick={onCerrar}>Cancelar</Button>
          <Button type="submit" tamano="lg" cargando={enviando}>Guardar presupuesto</Button>
        </div>
      </form>
    </Dialogo>
  )
}
