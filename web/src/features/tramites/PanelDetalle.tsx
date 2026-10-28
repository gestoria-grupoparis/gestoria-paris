import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { AccionesTramite } from './AccionesTramite'
import { obtenerTramite, type Catalogos } from './consultas'
import { EstadoChip } from './EstadoChip'
import { formatearFecha, formatearFechaHora, SITUACIONES } from './filtros'
import { HistorialEventos, MARCAS } from './HistorialEventos'

interface Props {
  id: string
  catalogos: Catalogos
  nombre: (id: string | null) => string
  onCerrar: () => void
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-linea px-4 py-3">
      <h3 className="mb-1.5 text-xs font-semibold text-tenue">{titulo}</h3>
      {children}
    </section>
  )
}

function Dato({ etiqueta, children, testId }: { etiqueta: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tenue">{etiqueta}</dt>
      <dd className="truncate text-sm" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

const pesos = (v: string | null | undefined) => (v == null ? '—' : formatearPesos(v))

export function PanelDetalle({ id, catalogos, nombre, onCerrar }: Props) {
  const q = useQuery({ queryKey: ['tramites', 'detalle', id], queryFn: () => obtenerTramite(id) })
  const t = q.data

  return (
    <aside
      aria-label="Detalle del trámite"
      className="fixed inset-0 z-30 overflow-y-auto bg-white md:static md:inset-auto md:z-auto md:w-[26rem] md:shrink-0 md:border-l md:border-linea"
    >
      <div className="sticky top-0 flex items-start justify-between gap-2 border-b border-linea bg-white px-4 py-3">
        <div className="min-w-0">
          {t && (
            <>
              <h2 className="text-base font-semibold">{t.numero}</h2>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-tenue">
                <EstadoChip estado={t.estado} testId="estado" />
                <span className="truncate">{t.tipo.nombre}</span>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label="Cerrar detalle"
          onClick={onCerrar}
          className="px-2 text-lg leading-none text-tenue hover:text-tinta focus-visible:outline-2 focus-visible:outline-marca"
        >
          ×
        </button>
      </div>

      {q.isPending && <p className="p-4 text-sm text-tenue">Cargando…</p>}
      {q.isError && (
        <p role="alert" className="p-4 text-sm text-alerta">
          No se pudo cargar el trámite.
        </p>
      )}
      {q.isSuccess && !t && <p className="p-4 text-sm text-tenue">No se encontró el trámite o no tenés acceso.</p>}

      {t && (
        <>
          <div className="px-4 py-3">
            <AccionesTramite tramite={t} catalogos={catalogos} />
          </div>
          <Seccion titulo="Datos">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Dato etiqueta="Cliente">{t.operacion.cliente_nombre}</Dato>
              <Dato etiqueta="Cuenta personal">{t.operacion.cuenta_personal}</Dato>
              <Dato etiqueta="Oferta">{t.operacion.oferta_ref}</Dato>
              <Dato etiqueta="Ingreso">{formatearFecha(t.created_at)}</Dato>
              <Dato etiqueta="Razón social">{t.operacion.empresa.nombre}</Dato>
              <Dato etiqueta="Sucursal">
                {t.operacion.sucursal.nombre} ({t.operacion.sucursal.provincia})
              </Dato>
              <Dato etiqueta="Vehículo">{t.vehiculo_desc}</Dato>
              <Dato etiqueta="Dominio">{t.dominio ?? t.chasis ?? '—'}</Dato>
              <Dato etiqueta="Gestora" testId="gestora">
                {t.gestora_id ? nombre(t.gestora_id) : 'Sin asignar'}
              </Dato>
              <Dato etiqueta="Situación financiera">
                {SITUACIONES[t.finanzas?.situacion ?? 'no_aplica'] ?? t.finanzas?.situacion}
              </Dato>
            </dl>
          </Seccion>
          <Seccion titulo="Marcas documentales">
            {t.marcas.length ? (
              <ul className="space-y-0.5 text-sm">
                {t.marcas.map((m) => (
                  <li key={m.marca}>
                    {MARCAS[m.marca] ?? m.marca}{' '}
                    <span className="text-xs text-tenue">
                      {nombre(m.por)}, {formatearFechaHora(m.at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-tenue">Sin marcas.</p>
            )}
          </Seccion>
          <Seccion titulo="Presupuesto">
            <dl className="mb-2 grid grid-cols-2 gap-x-3">
              <Dato etiqueta="Vigente">{pesos(t.finanzas?.presupuesto)}</Dato>
              <Dato etiqueta="Pagado">{pesos(t.finanzas?.pagado)}</Dato>
            </dl>
            {t.presupuestos.length > 0 && (
              <table className="w-full text-xs">
                <caption className="sr-only">Versiones del presupuesto</caption>
                <thead className="text-left text-tenue">
                  <tr>
                    <th className="font-medium">Versión</th>
                    <th className="font-medium">Fecha</th>
                    <th className="text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {t.presupuestos.map((p) => (
                    <tr key={p.version} title={p.motivo ?? undefined}>
                      <td>v{p.version}</td>
                      <td>{formatearFecha(p.created_at)}</td>
                      <td className="text-right">{formatearPesos(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Seccion>
          <Seccion titulo="Pagos">
            {t.pagos.length ? (
              <table className="w-full text-xs">
                <caption className="sr-only">Pagos del trámite</caption>
                <tbody>
                  {t.pagos.map((p) => (
                    <tr key={p.id}>
                      <td>{formatearFecha(`${p.fecha_operacion}T12:00:00Z`)}</td>
                      <td>{p.es_pago_final ? 'Pago final' : p.tipo === 'pago_tramite' ? 'Pago' : p.tipo}</td>
                      <td className="text-right">{formatearPesos(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-tenue">Sin pagos.</p>
            )}
          </Seccion>
          <Seccion titulo="Historial">
            <HistorialEventos tramiteId={t.id} nombre={nombre} />
          </Seccion>
        </>
      )}
    </aside>
  )
}
