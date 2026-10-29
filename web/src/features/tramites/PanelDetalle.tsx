import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useSesion } from '../../lib/sesion'
import { FormPago } from '../gestora/FormPago'
import { FormPresupuesto } from '../gestora/FormPresupuesto'
import { formatearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Button, cx, ErrorState, Patente, Skeleton } from '../../ui'
import { IconoAlerta, IconoCerrar, IconoCheck, IconoEscudo, IconoMas, IconoPesos, IconoRetorno } from '../../ui/Iconos'
import { AccionesTramite, FormAccion } from './AccionesTramite'
import { aprobarExcepcionFondos, desmarcar, marcar, obtenerTramite, type Catalogos, type TramiteDetalle } from './consultas'
import { EstadoChip, SituacionChip } from './EstadoChip'
import { etiquetaEstado, formatearFecha, formatearFechaHora } from './filtros'
import { etiquetaMovimiento, indicePaso, pagoEsExcepcion, PASOS, puedeAprobarExcepcion, puedePresupuestar } from './flujo'
import { FormReintegro } from './FormReintegro'
import { HistorialEventos, MARCAS } from './HistorialEventos'
import { EstimadoTramite } from '../analisis/EstimadoTramite'

interface Props {
  id: string
  catalogos: Catalogos
  nombre: (id: string | null) => string
  onCerrar: () => void
}

function Seccion({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="border-t border-linea px-5 py-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="rotulo">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  )
}

function Dato({ etiqueta, children, testId, ancho }: { etiqueta: string; children: ReactNode; testId?: string; ancho?: boolean }) {
  return (
    <div className={cx('min-w-0', ancho && 'col-span-2')}>
      <dt className="text-[12px] text-tenue">{etiqueta}</dt>
      <dd className="truncate text-[14px] font-medium" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

const pesos = (v: string | null | undefined) => (v == null ? '—' : formatearPesos(v))

/** Indicador de avance por el camino normal del trámite. */
function Recorrido({ estado }: { estado: string }) {
  const actual = indicePaso(estado)
  if (actual < 0)
    return (
      <p className="flex items-center gap-2 rounded-md bg-hundido px-3 py-2 text-[13px] text-tenue">
        <IconoAlerta className="size-4" /> Fuera del recorrido normal: {etiquetaEstado(estado)}.
      </p>
    )
  return (
    <ol aria-label="Avance del trámite" className="grid grid-cols-6 gap-1">
      {PASOS.map((p, i) => {
        const hecho = i < actual || (i === actual && estado === 'cerrado')
        const enCurso = i === actual && !hecho
        return (
          <li key={p.id} aria-current={enCurso ? 'step' : undefined} className="flex flex-col gap-1.5">
            <span className={cx('h-1.5 rounded-full', hecho ? 'bg-marca' : enCurso ? 'bg-acento' : 'bg-hundido')} />
            <span className={cx('truncate text-[11px] leading-tight', enCurso ? 'font-semibold text-tinta' : hecho ? 'text-tinta' : 'text-tenue')}>
              {p.etiqueta}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const ORDEN_MARCAS = ['legajo_recibido', 'firmado', 'recibido_admin', 'entregado', 'retirado']

function MarcasDocumentales({ t, nombre }: { t: TramiteDetalle; nombre: (id: string | null) => string }) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (marca: string) => marcar(t.id, marca),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tramites'] }),
  })
  const [quitar, setQuitar] = useState<string | null>(null)
  return (
    <>
      <ul aria-label="Marcas documentales" className="divide-y divide-linea overflow-hidden rounded-md ring-1 ring-linea">
        {ORDEN_MARCAS.map((clave) => {
          const hecha = t.marcas.find((x) => x.marca === clave)
          return (
            <li key={clave} className="flex min-h-12 items-center gap-3 bg-superficie px-3 py-1.5">
              <span
                aria-hidden
                className={cx(
                  'grid size-6 shrink-0 place-items-center rounded-full',
                  hecha ? 'bg-marca text-superficie' : 'ring-1 ring-linea-fuerte ring-inset',
                )}
              >
                {hecha && <IconoCheck className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cx('text-[14px]', hecha ? 'font-semibold' : 'text-tenue')}>{MARCAS[clave]}</div>
                {hecha && (
                  <div className="truncate text-[12px] text-tenue">
                    {nombre(hecha.por)}, {formatearFechaHora(hecha.at)}
                  </div>
                )}
              </div>
              {hecha && (
                <Button
                  variante="fantasma"
                  tamano="sm"
                  aria-label={`Quitar ${MARCAS[clave].toLowerCase()}`}
                  className="text-tenue"
                  onClick={() => setQuitar(clave)}
                >
                  Quitar
                </Button>
              )}
              {!hecha && (
                <Button
                  variante="fantasma"
                  tamano="sm"
                  aria-label={`Marcar ${MARCAS[clave].toLowerCase()}`}
                  disabled={m.isPending}
                  onClick={() => m.mutate(clave)}
                >
                  Marcar
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {m.isError && (
        <p role="alert" className="mt-2 text-sm text-sinfondos">
          {mensajeError(m.error)}
        </p>
      )}
      {quitar && (
        <FormAccion
          titulo={`Quitar marca: ${MARCAS[quitar]}`}
          rotulo={t.numero}
          boton="Quitar marca"
          aviso="Para corregir una marca puesta por error. Queda registrado en el historial quién la quitó y por qué."
          pideMotivo="Indicá por qué se quita la marca."
          ejecutar={(_, motivo) => desmarcar(t.id, quitar, motivo)}
          onCerrar={() => setQuitar(null)}
        />
      )}
    </>
  )
}

type FormDinero = 'presupuesto' | 'pago' | 'reintegro' | 'excepcion' | null

export function PanelDetalle({ id, catalogos, nombre, onCerrar }: Props) {
  const q = useQuery({ queryKey: ['tramites', 'detalle', id], queryFn: () => obtenerTramite(id) })
  const t = q.data
  const { rol } = useSesion()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormDinero>(null)
  const cerrarForm = () => setForm(null)
  const guardado = () => {
    setForm(null)
    void qc.invalidateQueries({ queryKey: ['tramites'] })
  }
  const tienePagos = !!t?.pagos.some((p) => p.tipo === 'pago_tramite')

  return (
    <aside
      aria-label="Detalle del trámite"
      className="fixed inset-0 z-30 overflow-y-auto bg-superficie pb-24 md:pb-0 md:sticky md:top-0 md:inset-auto md:z-auto md:h-dvh md:w-[27rem] md:shrink-0 md:border-l md:border-linea md:shadow-flotante"
    >
      <div className="sticky top-0 z-10 border-b border-linea bg-superficie/95 px-5 pt-4 pb-4 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="rotulo truncate">{t ? t.tipo.nombre : 'Trámite'}</div>
            {t ? (
              <h2 className="cifra mt-1 text-[28px] leading-none font-semibold">{t.numero}</h2>
            ) : (
              <Skeleton className="mt-2 h-7 w-40" />
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onCerrar}
            className="-mr-2 grid size-11 shrink-0 place-items-center rounded-md text-tenue hover:bg-hundido hover:text-tinta"
          >
            <IconoCerrar />
          </button>
        </div>
        {t && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <EstadoChip estado={t.estado} testId="estado" grande />
            <span className="text-[13px] text-tenue">Ingresó el {formatearFecha(t.created_at)}</span>
          </div>
        )}
      </div>

      {q.isPending && (
        <div role="status" className="space-y-3 p-5">
          <span className="sr-only">Cargando…</span>
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      )}
      {q.isError && (
        <div className="p-5">
          <ErrorState
            titulo="No se pudo cargar el trámite"
            accion={
              <Button variante="secundario" tamano="sm" onClick={() => void q.refetch()}>
                Reintentar
              </Button>
            }
          />
        </div>
      )}
      {q.isSuccess && !t && <p className="p-5 text-sm text-tenue">No se encontró el trámite o no tenés acceso.</p>}

      {t && (
        <>
          <div className="space-y-5 px-5 py-5">
            <Recorrido estado={t.estado} />
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-fondo px-3.5 py-3 ring-1 ring-linea">
                <div className="rotulo">Presupuesto</div>
                <div className="cifra mt-1 font-display text-[20px] font-semibold">{pesos(t.finanzas?.presupuesto)}</div>
              </div>
              <div className="rounded-md bg-fondo px-3.5 py-3 ring-1 ring-linea">
                <div className="rotulo">Pagado</div>
                <div className="cifra mt-1 font-display text-[20px] font-semibold">{pesos(t.finanzas?.pagado)}</div>
              </div>
              {t.finanzas?.situacion && t.finanzas.situacion !== 'no_aplica' && (
              <div className="col-span-2 flex items-center justify-between gap-2 px-1">
                <span className="text-[13px] text-tenue">Situación financiera</span>
                <SituacionChip situacion={t.finanzas.situacion} />
              </div>
              )}
              {puedeAprobarExcepcion(rol, t.finanzas?.situacion) && (
                <div className="col-span-2 rounded-md bg-sinfondos-suave px-3.5 py-3 ring-1 ring-sinfondos/20">
                  <p className="text-[13px] text-tinta">
                    La gestora ve <strong className="font-semibold text-sinfondos">No presentar: sin fondos</strong>. Si igual tiene que salir, liberalo con un motivo.
                  </p>
                  <Button variante="secundario" tamano="sm" className="mt-2.5" icono={<IconoEscudo className="size-4" />} onClick={() => setForm('excepcion')}>
                    Aprobar excepción de fondos
                  </Button>
                </div>
              )}
            </div>
            <AccionesTramite tramite={t} catalogos={catalogos} />
          </div>

          <Seccion titulo="Cliente y vehículo">
            <div className="mb-4">
              <div className="font-display text-[19px] leading-tight font-semibold">{t.operacion.cliente_nombre}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-tenue">
                <span>{t.vehiculo_desc}</span>
                {t.dominio ? <Patente dominio={t.dominio} /> : t.chasis ? <span className="font-mono text-[12px]">{t.chasis}</span> : null}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Dato etiqueta="Cuenta personal">{t.operacion.cuenta_personal}</Dato>
              <Dato etiqueta="Oferta">{t.operacion.oferta_ref}</Dato>
              <Dato etiqueta="Razón social">{t.operacion.empresa.nombre}</Dato>
              <Dato etiqueta="Sucursal">
                {t.operacion.sucursal.nombre} ({t.operacion.sucursal.provincia})
              </Dato>
              <Dato etiqueta="Gestora" testId="gestora" ancho>
                {t.gestora_id ? nombre(t.gestora_id) : 'Sin asignar'}
              </Dato>
            </dl>
          </Seccion>

          <Seccion titulo="Marcas documentales" extra={<span className="cifra text-[12px] text-tenue">{t.marcas.length} de 5</span>}>
            <MarcasDocumentales t={t} nombre={nombre} />
          </Seccion>

          <Seccion
            titulo="Presupuesto"
            extra={
              puedePresupuestar(t.estado) && (
                <Button variante="fantasma" tamano="sm" className="-my-1.5 -mr-2" icono={<IconoMas className="size-4" />} onClick={() => setForm('presupuesto')}>
                  {t.presupuestos.length ? 'Nueva versión' : 'Cargar presupuesto'}
                </Button>
              )
            }
          >
            {t.presupuestos.length > 0 ? (
              <table className="w-full text-[14px]">
                <caption className="sr-only">Versiones del presupuesto</caption>
                <thead className="text-left text-[12px] text-tenue">
                  <tr>
                    <th className="pb-1.5 font-medium">Versión</th>
                    <th className="pb-1.5 font-medium">Fecha</th>
                    <th className="pb-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {t.presupuestos.map((p, i) => (
                    <tr key={p.version} title={p.motivo ?? undefined} className="border-t border-linea">
                      <td className="py-2">
                        v{p.version}
                        {i === 0 && <span className="ml-2 text-[12px] font-semibold text-marca">vigente</span>}
                      </td>
                      <td className="py-2 text-tenue">{formatearFecha(p.created_at)}</td>
                      <td className="cifra py-2 text-right font-semibold">{formatearPesos(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-tenue">
                {puedePresupuestar(t.estado)
                  ? 'Todavía no hay presupuesto. Lo carga la gestora, o vos con el botón de arriba.'
                  : 'Se presupuesta cuando el trámite está autorizado.'}
              </p>
            )}
          </Seccion>

          {(rol === 'gerencia' || rol === 'contable') && (
            <Seccion titulo="Costo estimado" extra={<span className="text-[12px] text-tenue">Uso interno</span>}>
              <EstimadoTramite tramite={t.id} tipo={t.tipo.codigo} />
            </Seccion>
          )}

          <Seccion titulo="Pagos">
            {t.pagos.length ? (
              <table className="w-full text-[14px]">
                <caption className="sr-only">Pagos del trámite</caption>
                <tbody>
                  {t.pagos.map((p) => (
                    <tr key={p.id} className="border-t border-linea first:border-t-0">
                      <td className="py-2 text-tenue">{formatearFecha(`${p.fecha_operacion}T12:00:00Z`)}</td>
                      <td className="py-2">{etiquetaMovimiento(p.tipo, p.es_pago_final)}</td>
                      <td className="cifra py-2 text-right font-semibold">{formatearPesos(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-tenue">Sin pagos registrados.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button variante="secundario" tamano="sm" icono={<IconoPesos className="size-4" />} onClick={() => setForm('pago')}>
                Registrar pago
              </Button>
              {tienePagos && (
                <Button variante="fantasma" tamano="sm" icono={<IconoRetorno className="size-4" />} onClick={() => setForm('reintegro')}>
                  Registrar reintegro
                </Button>
              )}
            </div>
            {pagoEsExcepcion(t.estado) && (
              <p className="mt-2 text-[12px] text-tenue">Está {etiquetaEstado(t.estado).toLowerCase()}: un pago acá es una excepción y pide motivo.</p>
            )}
          </Seccion>

          <Seccion titulo="Historial">
            <HistorialEventos tramiteId={t.id} nombre={nombre} />
          </Seccion>

          {form === 'presupuesto' && (
            <FormPresupuesto tramite={t} nuevaVersion={t.presupuestos.length > 0} onCerrar={cerrarForm} onGuardado={guardado} />
          )}
          {form === 'pago' && (
            <FormPago
              tramite={{ id: t.id, numero: t.numero, estado: t.estado, presupuesto: t.finanzas?.presupuesto ?? null }}
              excepcion={pagoEsExcepcion(t.estado)}
              onCerrar={cerrarForm}
              onGuardado={guardado}
            />
          )}
          {form === 'reintegro' && <FormReintegro tramite={t} onCerrar={cerrarForm} />}
          {form === 'excepcion' && (
            <FormAccion
              titulo="Aprobar excepción de fondos"
              rotulo={t.numero}
              boton="Aprobar excepción"
              aviso={`El trámite se libera aunque ${t.operacion.empresa.nombre} no tenga saldo disponible. Queda registrado con tu usuario.`}
              pideMotivo="Indicá el motivo de la excepción."
              ejecutar={(_, motivo) => aprobarExcepcionFondos(t.id, motivo)}
              onCerrar={cerrarForm}
            />
          )}
        </>
      )}
    </aside>
  )
}
