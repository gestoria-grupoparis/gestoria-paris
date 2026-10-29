import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { useMutacionUnica } from '../../lib/consultas'
import { mensajeError } from '../../lib/errores'
import { Button, CampoPesos, Chip, Field, Skeleton, claseControl } from '../../ui'
import { compararEstimado, estimarTramite, ultimoEstimado, type DatosEstimar, type Estimado } from './consultas'
import { ETIQUETA_CONCEPTO, etiquetaConfianza } from './formato'

const PROVINCIAS = ['San Luis', 'San Juan', 'Mendoza', 'Córdoba']
const TONO = { completo: 'disponible', parcial: 'comprometido', sin_valor: 'sinfondos' } as const
const aTexto = (cents: string | null | undefined) => (cents ? formatearPesos(cents).replace('$ ', '') : '')

/**
 * Costo estimado del trámite (módulo interno: el panel solo lo monta para gerencia y contable).
 * No reemplaza al presupuesto de la gestora: lo compara para calibrar los parámetros.
 */
export function EstimadoTramite({ tramite, tipo }: { tramite: string; tipo: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['estimado', tramite], queryFn: () => ultimoEstimado(tramite) })
  const comp = useQuery({ queryKey: ['estimado', tramite, 'comparacion'], queryFn: () => compararEstimado(tramite), enabled: !!q.data })
  const [abierto, setAbierto] = useState(false)
  if (q.isPending) return <Skeleton className="h-16 w-full" />
  if (q.isError) return <p role="alert" className="text-sm text-sinfondos">No se pudo cargar el estimado.</p>
  return (
    <div className="space-y-3">
      {q.data ? <Detalle e={q.data} /> : !abierto && <p className="text-sm text-tenue">Todavía no se calculó. Sirve para prever fondos antes del presupuesto de la gestora.</p>}
      {q.data && comp.data?.real && (
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-hundido px-3 py-2 text-[13px]" aria-label="Estimado contra real">
          <div><dt className="text-tenue">Estimado</dt><dd className="cifra font-medium">{formatearPesos(comp.data.estimado ?? '0')}</dd></div>
          <div><dt className="text-tenue">Presupuesto real</dt><dd className="cifra font-medium">{formatearPesos(comp.data.real)}</dd></div>
          <div>
            <dt className="text-tenue">Diferencia</dt>
            <dd className="cifra font-medium" data-testid="diferencia-estimado">
              {comp.data.diferencia ? formatearPesos(comp.data.diferencia) : '—'}
              {comp.data.diferencia_pct && <span className="ml-1 text-tenue">({comp.data.diferencia_pct.replace('.', ',')} %)</span>}
            </dd>
          </div>
        </dl>
      )}
      {abierto ? (
        <FormEstimado
          tramite={tramite} tipo={tipo} previo={q.data}
          onCerrar={() => setAbierto(false)}
          onListo={() => { setAbierto(false); void qc.invalidateQueries({ queryKey: ['estimado', tramite] }) }}
        />
      ) : (
        <Button variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>{q.data ? 'Recalcular' : 'Calcular estimado'}</Button>
      )}
    </div>
  )
}

function Detalle({ e }: { e: Estimado }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="cifra text-[22px] font-semibold" data-testid="total-estimado">{formatearPesos(e.total)}</span>
        <Chip tono={TONO[e.confianza]}>{etiquetaConfianza(e.confianza)}</Chip>
      </div>
      <table className="w-full text-[13px]">
        <caption className="sr-only">Detalle del estimado (versión {e.version})</caption>
        <tbody>
          {e.lineas.map((l) => (
            <tr key={l.concepto} className="border-t border-linea align-top">
              <td className="py-2 pr-2">
                <div className="font-medium">{ETIQUETA_CONCEPTO[l.concepto] ?? l.concepto}</div>
                <div className="text-[12px] text-tenue">
                  {l.base_cents && <>Base {formatearPesos(l.base_cents)} · </>}{l.regla}
                </div>
                <div className="text-[12px] text-tenue">Fuente: {l.fuente}</div>
              </td>
              <td className="cifra py-2 text-right font-semibold whitespace-nowrap">
                {l.importe_cents == null ? <span className="font-normal text-comprometido">Sin dato</span> : formatearPesos(l.importe_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[12px] text-tenue">Versión {e.version}. Las líneas sin dato se completan con lo que informe la gestora.</p>
    </div>
  )
}

function FormEstimado({ tramite, tipo, previo, onCerrar, onListo }: { tramite: string; tipo: string; previo: Estimado | null | undefined; onCerrar: () => void; onListo: () => void }) {
  const esTransferencia = tipo !== 'patentamiento_0km'
  const [valor, setValor] = useState(aTexto(previo?.entrada.valor_cents))
  const [prenda, setPrenda] = useState(aTexto(previo?.entrada.prenda_cents === '0' ? null : previo?.entrada.prenda_cents))
  const [vehiculo, setVehiculo] = useState<DatosEstimar['vehiculo']>((previo?.entrada.vehiculo as DatosEstimar['vehiculo']) ?? 'auto')
  const [destino, setDestino] = useState<DatosEstimar['destino']>(
    (previo?.entrada.destino as DatosEstimar['destino']) ?? (tipo === 'transferencia_parte_pago' ? 'habitualista_08' : 'cliente'))
  const [provincia, setProvincia] = useState('')
  const [error, setError] = useState<string | null>(null)
  const m = useMutacionUnica({
    mutationFn: () =>
      estimarTramite({
        tramite, vehiculo, provincia: provincia || null, destino: esTransferencia ? destino : 'cliente',
        valor: valor.trim() ? parsearPesos(valor).toString() : null,
        prenda: prenda.trim() ? parsearPesos(prenda).toString() : null,
      }),
    onSuccess: onListo,
    onError: (e) => setError(mensajeError(e)),
  })
  return (
    <form aria-label="Calcular estimado" className="space-y-3 rounded-md ring-1 ring-linea p-3" onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate() }}>
      <Field label="Valor de referencia" ayuda="Precio de factura del 0 km o valor declarado del usado.">
        {(c) => <CampoPesos {...c} value={valor} onValor={setValor} />}
      </Field>
      <Field label="Monto de la prenda" ayuda="Vacío si no lleva prenda.">
        {(c) => <CampoPesos {...c} value={prenda} onValor={setPrenda} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehículo">
          {(c) => (
            <select {...c} className={claseControl} value={vehiculo} onChange={(e) => setVehiculo(e.target.value as DatosEstimar['vehiculo'])}>
              <option value="auto">Auto o pick-up</option>
              <option value="moto">Moto</option>
            </select>
          )}
        </Field>
        <Field label="Provincia">
          {(c) => (
            <select {...c} className={claseControl} value={provincia} onChange={(e) => setProvincia(e.target.value)}>
              <option value="">La de la sucursal</option>
              {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </Field>
      </div>
      {esTransferencia && (
        <Field label="Destinatario">
          {(c) => (
            <select {...c} className={claseControl} value={destino} onChange={(e) => setDestino(e.target.value as DatosEstimar['destino'])}>
              <option value="cliente">Cliente (transferencia común)</option>
              <option value="habitualista_08">La concesionaria como habitualista (Tipo 08)</option>
              <option value="reventa_90">Reventa de la concesionaria dentro de los 90 días</option>
            </select>
          )}
        </Field>
      )}
      {error && <p role="alert" className="text-sm text-sinfondos">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variante="fantasma" tamano="sm" onClick={onCerrar} disabled={m.isPending}>Cancelar</Button>
        <Button type="submit" tamano="sm" cargando={m.isPending}>Calcular</Button>
      </div>
    </form>
  )
}
