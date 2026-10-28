import { useState, type FormEvent } from 'react'
import { parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from '../tramites/Dialogo'
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
    <div className="grid grid-cols-2 gap-3">
      {CONCEPTOS.map((c) => (
        <label key={c.id} className={CLASE_ETIQUETA}>
          {c.etiqueta}
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={valor[c.id]}
            onChange={(e) => onCambio({ ...valor, [c.id]: e.target.value })}
            className={`${CLASE_CAMPO} py-2.5 text-right text-base`}
          />
        </label>
      ))}
    </div>
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
    <Dialogo titulo="Cargar presupuesto" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-tenue">Trámite {tramite.numero}. El total lo calcula el sistema.</p>
        <CamposConceptos valor={valor} onCambio={setValor} />
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className={`${CLASE_SECUNDARIO} flex-1 py-3`}>Cancelar</button>
          <button type="submit" disabled={enviando} className={`${CLASE_PRIMARIO} flex-1 py-3`}>Guardar presupuesto</button>
        </div>
      </form>
    </Dialogo>
  )
}
