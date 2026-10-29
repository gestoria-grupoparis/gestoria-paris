import { useState } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Button, Field, Input, claseControl } from '../../ui'
import { hoyEnBuenosAires } from '../tramites/filtros'
import { buscarVehiculo, type Vehiculo } from './consultas'

const ANIOS = Array.from({ length: 26 }, (_, i) => 2025 - i)
const anioTexto = (a: number) => (a === 0 ? '0 km' : String(a))

/**
 * Buscador del vehículo en la tabla de valuaciones DNRPA vigente. Nunca elige solo:
 * el usuario marca el resultado que corresponde (o ninguno, y el estimado sigue como antes).
 */
export function SelectorVehiculo({ cero, elegido, onElegir }: { cero: boolean; elegido: Vehiculo | null; onElegir: (v: Vehiculo | null) => void }) {
  const [texto, setTexto] = useState('')
  const [anio, setAnio] = useState(cero ? '0' : '')
  const [res, setRes] = useState<Vehiculo[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buscar() {
    if (!texto.trim()) return
    setError(null); setBuscando(true)
    try {
      setRes(await buscarVehiculo(texto, anio === '' ? null : Number(anio), hoyEnBuenosAires()))
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setBuscando(false)
    }
  }

  if (elegido) {
    return (
      <div className="rounded-md bg-hundido px-3 py-2 text-[13px]" aria-label="Vehículo de la tabla DNRPA">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-medium">{elegido.marca} {elegido.modelo} · {anioTexto(elegido.anio)}</div>
            <div className="text-tenue">{elegido.version} · MTM {elegido.mtm} · {elegido.disposicion}</div>
            <div className="cifra font-medium">Valuación {formatearPesos(elegido.valor)}</div>
          </div>
          <Button variante="fantasma" tamano="sm" onClick={() => onElegir(null)}>Quitar</Button>
        </div>
      </div>
    )
  }

  return (
    <fieldset className="space-y-2 rounded-md ring-1 ring-linea p-3">
      <legend className="px-1 text-[13px] font-medium">Vehículo en la tabla DNRPA (opcional)</legend>
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <Field label="Marca, modelo o versión">
          {(c) => (
            <Input
              {...c} value={texto} placeholder="Ej.: fiat cronos drive"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscar() } }}
            />
          )}
        </Field>
        <Field label="Año">
          {(c) => (
            <select {...c} className={claseControl} value={anio} onChange={(e) => setAnio(e.target.value)}>
              <option value="">Todos</option>
              <option value="0">0 km</option>
              {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </Field>
        <Button variante="secundario" tamano="sm" className="col-span-2 sm:col-span-1 sm:mb-0.5" onClick={() => void buscar()} cargando={buscando} disabled={!texto.trim()}>
          Buscar
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-sinfondos">{error}</p>}
      {res && res.length === 0 && (
        <p className="text-[13px] text-tenue">Sin resultados en la tabla vigente. Probá con menos palabras o sin año; si no figura, usá solo el valor declarado.</p>
      )}
      {res && res.length > 0 && (
        <ul aria-label="Resultados de la tabla DNRPA" className="max-h-56 divide-y divide-linea overflow-auto rounded-md ring-1 ring-linea">
          {res.map((v) => (
            <li key={`${v.mtm}-${v.anio}`}>
              <button
                type="button" onClick={() => onElegir(v)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-hover focus-visible:outline-2 focus-visible:outline-acento"
              >
                <span>
                  <span className="font-medium">{v.marca} {v.modelo}</span>
                  <span className="block text-tenue">{v.version} · {anioTexto(v.anio)} · MTM {v.mtm}</span>
                </span>
                <span className="cifra font-medium whitespace-nowrap">{formatearPesos(v.valor)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {res && res.length === 50 && <p className="text-[12px] text-tenue">Se muestran los primeros 50: agregá palabras para afinar.</p>}
    </fieldset>
  )
}
