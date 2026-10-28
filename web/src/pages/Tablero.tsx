import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { formatearPesos } from '../lib/dinero'
import { listarSaldos, type Saldo } from '../features/habitualista/consultas'
import { useFinanzasEnVivo } from '../features/habitualista/enVivo'
import { conciliacionVencida, fechaOperativa, necesidadRecarga } from '../features/habitualista/saldos'
import { contarPorEstado, listarIntervencion, type Motivo } from '../features/tablero/consultas'
import { ESTADOS, hoyEnBuenosAires } from '../features/tramites/filtros'
import {
  Card, CardHeader, Chip, EmptyState, ErrorState, IconoAlerta, IconoCheck, IconoChevron, IconoDoc, IconoProhibido,
  IconoReloj, KpiTile, PageHeader, Skeleton, TONO_ESTADO, cx, type TonoChip,
} from '../ui'

const MOTIVOS: Record<Motivo, { texto: string; tono: TonoChip }> = {
  observado: { texto: 'Observado', tono: 'comprometido' },
  sin_fondos: { texto: 'Sin fondos', tono: 'sinfondos' },
  demorado: { texto: 'Demorado sin presentar', tono: 'info' },
}

/** Estados que ya no requieren trabajo: no cuentan como "abiertos". */
const TERMINALES = new Set(['cerrado', 'cancelado', 'rechazado'])

/** Color de la barra por tono de estado (mismo código que los chips). */
const BARRA: Record<TonoChip, string> = {
  neutro: 'bg-linea-fuerte',
  marca: 'bg-marca',
  info: 'bg-info',
  disponible: 'bg-disponible',
  comprometido: 'bg-comprometido',
  sinfondos: 'bg-sinfondos',
  apagado: 'bg-linea',
  solido: 'bg-noche',
}

const negativo = (cents: string) => cents.startsWith('-') && !/^-0+$/.test(cents)

function TarjetaEmpresa({ s, hoy }: { s: Saldo; hoy: string }) {
  const recarga = necesidadRecarga(s.disponible)
  const falta = recarga !== '0'
  const vencida = conciliacionVencida(s.ultima_conciliacion_fecha, s.ultima_diferencia, hoy)
  return (
    <article
      aria-label={s.empresa}
      className={cx(
        'flex flex-col rounded-lg bg-superficie shadow-tarjeta ring-1',
        falta ? 'ring-sinfondos/40' : 'ring-linea',
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <h3 className="text-lg font-semibold leading-tight">{s.empresa}</h3>
        {falta ? <Chip tono="sinfondos">Sin fondos</Chip> : <Chip tono="disponible">Con fondos</Chip>}
      </div>
      <div className="px-5 pt-4">
        <div className="rotulo">Disponible</div>
        <div
          data-testid="disponible"
          className={cx('cifra font-display text-[32px] font-semibold leading-tight tracking-tight', falta ? 'text-sinfondos' : 'text-marca')}
        >
          {formatearPesos(s.disponible)}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-linea px-5 py-4 text-sm">
        <div>
          <dt className="rotulo">Registrado</dt>
          <dd data-testid="registrado" className={cx('cifra mt-0.5 font-semibold', negativo(s.registrado) && 'text-sinfondos')}>
            {formatearPesos(s.registrado)}
          </dd>
        </div>
        <div>
          <dt className="rotulo">Comprometido</dt>
          <dd data-testid="comprometido" className="cifra mt-0.5 font-semibold text-comprometido">{formatearPesos(s.comprometido)}</dd>
        </div>
        <div>
          <dt className="rotulo">Necesidad de recarga</dt>
          <dd data-testid="recarga" className={cx('cifra mt-0.5 font-semibold', falta ? 'text-sinfondos' : 'text-tenue')}>
            {formatearPesos(recarga)}
          </dd>
        </div>
        <div>
          <dt className="rotulo">Conciliación</dt>
          <dd className={cx('mt-0.5 flex flex-wrap items-center gap-1 font-semibold', vencida ? 'text-comprometido' : 'text-disponible')}>
            {vencida ? <IconoReloj className="size-4" /> : <IconoCheck className="size-4" />}
            {s.ultima_conciliacion_fecha ? fechaOperativa(s.ultima_conciliacion_fecha) : 'Nunca'}
            {vencida && <span className="font-normal">· sin verificar</span>}
          </dd>
        </div>
      </dl>
      <Link
        to={`/habitualista?empresa=${s.empresa_id}`}
        className="mt-auto flex min-h-11 items-center justify-between rounded-b-lg border-t border-linea px-5 py-3 text-sm font-semibold text-marca hover:bg-marca-suave/50"
      >
        Ver extracto y movimientos <IconoChevron className="size-4" />
      </Link>
    </article>
  )
}

export function Tablero() {
  useFinanzasEnVivo('tablero-pantalla', 'tablero')
  const saldos = useQuery({ queryKey: ['tablero', 'saldos'], queryFn: listarSaldos })
  const conteo = useQuery({ queryKey: ['tablero', 'conteo'], queryFn: contarPorEstado })
  const intervencion = useQuery({ queryKey: ['tablero', 'intervencion'], queryFn: listarIntervencion })
  const hoy = hoyEnBuenosAires()

  // Conteos de trámites (enteros, no montos).
  const abiertos = conteo.data ? ESTADOS.filter((e) => !TERMINALES.has(e.id)).reduce((n, e) => n + (conteo.data[e.id] ?? 0), 0) : null
  const maximo = conteo.data ? Math.max(1, ...ESTADOS.map((e) => conteo.data[e.id] ?? 0)) : 1
  const cuenta = (m: Motivo) => intervencion.data?.filter((t) => t.motivos.includes(m)).length ?? null
  const conRecarga = saldos.data?.filter((s) => necesidadRecarga(s.disponible) !== '0').length ?? null
  const kpi = (n: number | null) => (n == null ? <Skeleton className="h-7 w-16" /> : n)

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo={`Resumen al ${fechaOperativa(hoy)}`}
        titulo="Tablero"
        descripcion="Cómo están los fondos de cada razón social y qué trámites necesitan que alguien haga algo hoy."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile rotulo="Trámites abiertos" tono="destacado" icono={<IconoDoc />} valor={kpi(abiertos)} detalle="Sin contar cerrados, cancelados ni rechazados" />
        <KpiTile
          rotulo="Requieren intervención"
          tono={intervencion.data?.length ? 'comprometido' : 'neutro'}
          icono={<IconoAlerta />}
          valor={kpi(intervencion.data?.length ?? null)}
          detalle="Observados, sin fondos o demorados"
        />
        <KpiTile
          rotulo="Sin fondos"
          tono={cuenta('sin_fondos') ? 'sinfondos' : 'neutro'}
          icono={<IconoProhibido />}
          valor={kpi(cuenta('sin_fondos'))}
          detalle="No se pueden presentar todavía"
        />
        <KpiTile
          rotulo="Cuentas a recargar"
          tono={conRecarga ? 'sinfondos' : 'disponible'}
          icono={<IconoReloj />}
          valor={kpi(conRecarga)}
          detalle={conRecarga ? 'El disponible no cubre lo comprometido' : 'Todas cubren lo comprometido'}
        />
      </div>

      <section aria-labelledby="t-saldos" className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <div className="rotulo mb-1">Habitualista</div>
            <h2 id="t-saldos" className="text-[22px] font-semibold">Fondos por razón social</h2>
          </div>
          <Link to="/habitualista" className="hidden text-sm font-semibold text-marca hover:underline sm:block">Ir a Habitualista</Link>
        </div>
        {saldos.isError ? (
          <ErrorState titulo="No se pudieron cargar los saldos." accion={<button type="button" className="w-fit text-sm font-semibold underline" onClick={() => void saldos.refetch()}>Reintentar</button>} />
        ) : !saldos.data ? (
          <div role="status" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <span className="sr-only">Cargando saldos…</span>
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        ) : saldos.data.length === 0 ? (
          <EmptyState titulo="Sin razones sociales a la vista" descripcion="Tu usuario no tiene alcance sobre ninguna cuenta de la Habitualista." />
        ) : (
          <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
            {saldos.data.map((s) => <TarjetaEmpresa key={s.cuenta_id} s={s} hoy={hoy} />)}
          </div>
        )}
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section aria-labelledby="t-estados">
          <Card className="h-full">
            <CardHeader rotulo="Trámites" titulo={<span id="t-estados">Trámites por estado</span>} />
            {conteo.isError ? (
              <div className="p-5"><ErrorState titulo="No se pudieron contar los trámites." /></div>
            ) : !conteo.data ? (
              <div role="status" className="flex flex-col gap-3 p-5">
                <span className="sr-only">Contando trámites…</span>
                {ESTADOS.map((e) => <Skeleton key={e.id} className="h-6" />)}
              </div>
            ) : (
              <ul className="flex flex-col p-3">
                {ESTADOS.map((e) => {
                  const n = conteo.data[e.id] ?? 0
                  const tono = TONO_ESTADO[e.id] ?? 'neutro'
                  return (
                    <li key={e.id}>
                      <Link
                        to={`/tramites?estado=${e.id}`}
                        className={cx('grid min-h-11 grid-cols-[9.5rem_1fr_2.5rem] md:min-h-10 items-center gap-3 rounded-md px-3 hover:bg-marca-suave/50', !n && 'text-tenue')}
                      >
                        <span className="truncate text-sm font-semibold">{e.etiqueta}</span>{' '}
                        <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-hundido">
                          <span className={cx('block h-full rounded-full', BARRA[tono])} style={{ width: `${(n / maximo) * 100}%` }} />
                        </span>{' '}
                        <strong className="cifra text-right font-display text-base">{n}</strong>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </section>

        <section aria-labelledby="t-intervencion" className="order-first lg:order-none">
          <Card className="h-full">
            <CardHeader
              rotulo="Para hoy"
              titulo={<span id="t-intervencion">Requieren intervención</span>}
              acciones={intervencion.data?.length ? <Chip tono="comprometido">{intervencion.data.length}</Chip> : undefined}
            />
            {intervencion.isError ? (
              <div className="p-5"><ErrorState titulo="No se pudo cargar la lista." /></div>
            ) : !intervencion.data ? (
              <div role="status" className="flex flex-col gap-3 p-5">
                <span className="sr-only">Cargando…</span>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : intervencion.data.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icono={<IconoCheck className="size-6" />}
                  titulo="Nada pendiente"
                  descripcion="No hay observados, sin fondos ni demorados."
                />
              </div>
            ) : (
              <ul aria-label="Requieren intervención" className="divide-y divide-linea">
                {intervencion.data.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tramites?t=${t.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-marca-suave/40">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="cifra font-semibold">{t.numero}</span>
                          <span className="truncate">{t.cliente}</span>
                        </span>
                        <span className="block text-[13px] text-tenue">{t.empresa}</span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {t.motivos.map((m) => <Chip key={m} tono={MOTIVOS[m].tono}>{MOTIVOS[m].texto}</Chip>)}
                        </span>
                      </span>
                      <IconoChevron className="size-5 text-tenue" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}
