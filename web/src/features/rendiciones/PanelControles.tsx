import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { formatearPesos } from '../../lib/dinero'
import { codigoError, mensajeError } from '../../lib/errores'
import { useMutacionUnica } from '../../lib/consultas'
import { Button, Cargando, Chip, Dialogo, ErrorState, Field, claseControl, cx } from '../../ui'
import { cambiarEstadoRendicion, controles, type EstadoRendicion, type RendicionDetalle } from './consultas'

type Vista = 'planilla' | 'comprobantes' | 'controles'

const MOTIVO_NO_AUT = { sin_vincular: 'sin trámite vinculado', ambiguo: 'vínculo ambiguo', no_autorizado: 'trámite no autorizado' }

function Tarjeta({ titulo, ok, cifra, detalle, children }: { titulo: string; ok: boolean; cifra: ReactNode; detalle: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label={`Control de ${titulo.toLowerCase()}`} className={cx('flex flex-col gap-3 rounded-lg bg-superficie p-5 ring-1', ok ? 'ring-linea' : 'ring-sinfondos/35')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{titulo}</h2>
        <Chip tono={ok ? 'disponible' : 'sinfondos'}>{ok ? 'OK' : 'Con diferencias'}</Chip>
      </div>
      <div className="cifra font-display text-[22px] leading-tight font-medium">{cifra}</div>
      <div className="text-[13px] text-tenue">{detalle}</div>
      {children}
    </section>
  )
}

type Accion = { estado: EstadoRendicion; titulo: string; boton: string; pideMotivo?: boolean; aviso?: string } | null

export function PanelControles({ rendicion, onIr }: { rendicion: RendicionDetalle; onIr: (v: Vista, fila?: string) => void }) {
  const r = rendicion
  const qc = useQueryClient()
  const c = useQuery({ queryKey: ['rendiciones', 'controles', r.id, r.version], queryFn: () => controles(r.id) })
  const [accion, setAccion] = useState<Accion>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cambiar = useMutacionUnica({
    mutationFn: (a: { estado: EstadoRendicion; motivo: string | null }) =>
      cambiarEstadoRendicion({ id: r.id, estado: a.estado, motivo: a.motivo, version: r.version }),
    onSuccess: async () => {
      setAccion(null)
      setMotivo('')
      await qc.invalidateQueries({ queryKey: ['rendiciones'] })
    },
    onError: (e) => setError(codigoError(e) === 'VERSION_CONFLICTO' ? 'Otro usuario modificó esta rendición. Recargá para ver los cambios.' : mensajeError(e)),
  })

  if (c.isError)
    return <ErrorState titulo="No se pudieron calcular los controles." descripcion={mensajeError(c.error)}
      accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void c.refetch()}>Reintentar</Button>} />
  if (!c.data) return <Cargando etiqueta="Calculando los controles…" />
  const k = c.data
  const todoOk = k.importes.ok && k.autorizados.ok && k.honorarios.ok
  const filasMal = k.importes.filas.filter((f) => !f.ok)

  const abrir = (a: NonNullable<Accion>) => {
    setError(null)
    setMotivo('')
    setAccion(a)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Tarjeta
          titulo="Importes"
          ok={k.importes.ok}
          cifra={formatearPesos(k.importes.total_planilla_cents)}
          detalle={<>Debitado de la Habitualista en el mes: <strong className="cifra text-tinta">{formatearPesos(k.importes.debitado_habitualista_cents)}</strong> · diferencia <strong className="cifra text-tinta">{formatearPesos(k.importes.diferencia_cents)}</strong></>}
        >
          {filasMal.length > 0 && (
            <ul aria-label="Filas con diferencia" className="flex flex-col gap-1.5">
              {filasMal.map((f) => (
                <li key={f.fila_id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate">{f.nombre} · <span className="cifra font-semibold text-sinfondos">{formatearPesos(f.diferencia_cents)}</span></span>
                  <Button variante="fantasma" tamano="sm" onClick={() => onIr('comprobantes', f.fila_id)}>Ver comprobantes</Button>
                </li>
              ))}
            </ul>
          )}
          {k.importes.movimientos_sin_rendir.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-semibold text-sinfondos">Pagos del mes que no están en la planilla</p>
              <ul aria-label="Movimientos sin rendir" className="flex flex-col gap-1">
                {k.importes.movimientos_sin_rendir.map((m) => (
                  <li key={m.movimiento_id} className="flex items-center justify-between gap-2 text-[13px]">
                    {m.tramite_id ? <Link className="underline" to={`/tramites?t=${m.tramite_id}`}>{m.tramite_numero ?? 'Trámite'}</Link> : <span>Sin trámite</span>}
                    <span className="cifra">{m.fecha.split('-').reverse().join('/')} · {formatearPesos(m.importe_cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Tarjeta>
        <Tarjeta
          titulo="Autorizados"
          ok={k.autorizados.ok}
          cifra={k.autorizados.ok ? 'Todos autorizados' : `${k.autorizados.filas_no_autorizadas.length} sin autorizar`}
          detalle="Cada fila tiene que corresponder a un trámite autorizado de esta razón social."
        >
          {k.autorizados.filas_no_autorizadas.length > 0 && (
            <ul aria-label="Filas no autorizadas" className="flex flex-col gap-1.5">
              {k.autorizados.filas_no_autorizadas.map((f) => (
                <li key={f.fila_id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate">{f.nombre} · {MOTIVO_NO_AUT[f.motivo]}</span>
                  <Button variante="fantasma" tamano="sm" onClick={() => onIr('planilla')}>Vincular</Button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        <Tarjeta
          titulo="Honorarios"
          ok={k.honorarios.ok}
          cifra={formatearPesos(k.honorarios.esperado_cents)}
          detalle={<span data-testid="detalle-honorarios">{k.honorarios.cantidad_tramites} trámites × {formatearPesos(k.honorarios.honorario_unitario_cents)} = {formatearPesos(k.honorarios.esperado_cents)} — facturado {formatearPesos(k.honorarios.facturado_cents)}</span>}
        >
          {k.honorarios.ok ? (
            <p className="rounded-md bg-disponible-suave px-3 py-2 text-[13px] font-semibold text-disponible">Monto a pagar de honorarios: {formatearPesos(k.honorarios.esperado_cents)}</p>
          ) : (
            <p className="text-[13px] text-sinfondos">Diferencia con lo facturado: <span className="cifra font-semibold">{formatearPesos(k.honorarios.diferencia_cents)}</span></p>
          )}
        </Tarjeta>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-superficie p-4 ring-1 ring-linea md:flex-row md:items-center md:justify-between">
        <p className="text-[13px] text-tenue">Aprobar cierra la rendición. No crea movimientos ni cambia saldos.</p>
        <div className="flex flex-wrap gap-2">
          {(r.estado === 'borrador' || r.estado === 'observada') && (
            <Button onClick={() => abrir({ estado: 'enviada', titulo: 'Enviar a control', boton: 'Enviar a control', aviso: 'Deja de editarse hasta que la observen o la aprueben.' })}>Enviar a control</Button>
          )}
          {r.estado === 'enviada' && (
            <>
              <Button variante="secundario" onClick={() => abrir({ estado: 'observada', titulo: 'Observar rendición', boton: 'Observar', pideMotivo: true })}>Observar</Button>
              <Button onClick={() => abrir({ estado: 'aprobada', titulo: 'Aprobar rendición', boton: 'Aprobar', aviso: todoOk ? 'Los tres controles están en verde.' : 'Hay diferencias sin resolver. ¿Aprobar igual?' })}>Aprobar</Button>
            </>
          )}
          {r.estado === 'aprobada' && (
            <Button variante="secundario" onClick={() => abrir({ estado: 'borrador', titulo: 'Reabrir rendición', boton: 'Reabrir', pideMotivo: true })}>Reabrir</Button>
          )}
        </div>
      </div>

      {accion && (
        <Dialogo titulo={accion.titulo} rotulo={r.empresa} onCerrar={() => setAccion(null)} bloqueado={cambiar.isPending}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (accion.pideMotivo && !motivo.trim()) return setError('Indicá el motivo.')
              cambiar.mutate({ estado: accion.estado, motivo: motivo.trim() || null })
            }}
          >
            {accion.aviso && (
              <p className={cx('rounded-md px-4 py-3 text-sm', accion.estado === 'aprobada' && !todoOk ? 'bg-sinfondos-suave font-semibold text-sinfondos' : 'bg-hundido text-tinta')}>{accion.aviso}</p>
            )}
            {accion.pideMotivo && (
              <Field label="Motivo">
                {(p) => <textarea {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={cx(claseControl, 'h-auto py-2')} />}
              </Field>
            )}
            {error && <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">{error}</p>}
            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              <Button variante="secundario" onClick={() => setAccion(null)} disabled={cambiar.isPending}>Cancelar</Button>
              <Button type="submit" cargando={cambiar.isPending}>{accion.boton}</Button>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  )
}
