import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { formatearPesos } from '../lib/dinero'
import { exportarPlanilla } from '../lib/planilla'
import { listarSaldos } from '../features/habitualista/consultas'
import { informeCierre, informeCostos, type CierreMensual, type CostoTramite } from '../features/informes/consultas'
import { COLUMNAS_CIERRE_PLANILLA, COLUMNAS_COSTOS_PLANILLA } from '../features/informes/exportar'
import { esCero, etiquetaMes, formatearPct, mesesRecientes, primerDiaDelMes, tonoDesvio } from '../features/informes/meses'
import { etiquetaEstado, hoyEnBuenosAires } from '../features/tramites/filtros'
import {
  Button, Cargando, Chip, ChipEstado, DataTable, EmptyState, ErrorState, KpiTile, MenuExportar, PageHeader,
  celdaMonto, celdaPrincipal, claseControl, cx, type TonoKpi,
} from '../ui'

type Vista = 'cierre' | 'costos'
const MESES_SELECCIONABLES = 24

const Importe = ({ cents }: { cents: string }) => <span data-testid="importe">{formatearPesos(cents)}</span>
const negativo = (cents: string) => cents.startsWith('-') && !/^-0+$/.test(cents)
/** Un importe en cero no lleva color: gris tenue, para que resalte lo que sí se movió. */
const tono = (cents: string, clase: string) => (esCero(cents) ? 'text-tenue' : clase)

function Kpi({ titulo, ...p }: { titulo: string; valor: ReactNode; detalle?: ReactNode; tono?: TonoKpi; grande?: boolean; className?: string }) {
  return (
    <section aria-label={titulo} className={p.className}>
      <KpiTile rotulo={titulo} {...p} className="h-full justify-between" />
    </section>
  )
}

function Filtro({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="rotulo">{etiqueta}</span>
      {children}
    </label>
  )
}

export function Informes() {
  const hoy = hoyEnBuenosAires()
  const meses = mesesRecientes(hoy, MESES_SELECCIONABLES)
  const [params, setParams] = useSearchParams()
  const mes = meses.includes(params.get('mes') ?? '') ? params.get('mes')! : meses[0]
  const vista: Vista = params.get('vista') === 'costos' ? 'costos' : 'cierre'
  const empresas = useQuery({ queryKey: ['habitualista', 'saldos'], queryFn: listarSaldos })
  const empresa = empresas.data?.some((e) => e.empresa_id === params.get('empresa')) ? params.get('empresa') : null

  const cambiar = (clave: string, valor: string | null) => {
    const p = new URLSearchParams(params)
    if (valor) p.set(clave, valor)
    else p.delete(clave)
    setParams(p, { replace: true })
  }

  const cierre = useQuery({
    queryKey: ['informes', 'cierre', mes, empresa],
    queryFn: () => informeCierre(primerDiaDelMes(mes), empresa),
    enabled: vista === 'cierre' && !!empresas.data,
    placeholderData: keepPreviousData,
  })
  const costos = useQuery({
    queryKey: ['informes', 'costos', mes, empresa],
    queryFn: () => informeCostos(primerDiaDelMes(mes), empresa),
    enabled: vista === 'costos' && !!empresas.data,
    placeholderData: keepPreviousData,
  })

  const actual = vista === 'cierre' ? cierre : costos
  const exportar = async (formato: 'csv' | 'xlsx') => {
    const opciones = { hoy, prefijo: `${vista}-${etiquetaMes(mes)}`, hoja: vista === 'cierre' ? 'Cierre mensual' : 'Costos' }
    if (vista === 'cierre') await exportarPlanilla(formato, COLUMNAS_CIERRE_PLANILLA, cierre.data ?? [], opciones)
    else await exportarPlanilla(formato, COLUMNAS_COSTOS_PLANILLA, costos.data ?? [], opciones)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo="Control y análisis"
        titulo="Informes"
        descripcion="Cierre mensual de cada Habitualista y lo que costó cada trámite contra su presupuesto. Todo se calcula desde los movimientos registrados, por fecha de operación."
        acciones={
          <MenuExportar
            disabled={!actual.data?.length}
            title="Descarga el informe del mes con los filtros aplicados"
            onExportar={exportar}
          />
        }
      />

      <div className="mb-6 flex flex-col gap-4 rounded-lg bg-superficie p-4 ring-1 ring-linea md:flex-row md:items-end md:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:gap-4">
          <Filtro etiqueta="Mes">
            <select value={mes} onChange={(e) => cambiar('mes', e.target.value)} className={cx(claseControl, 'font-semibold md:min-w-48')}>
              {meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
            </select>
          </Filtro>
          <Filtro etiqueta="Razón social">
            <select
              value={empresa ?? ''}
              onChange={(e) => cambiar('empresa', e.target.value || null)}
              className={cx(claseControl, 'font-semibold md:min-w-56')}
              disabled={!empresas.data}
            >
              <option value="">Todas</option>
              {empresas.data?.map((e) => <option key={e.empresa_id} value={e.empresa_id}>{e.empresa}</option>)}
            </select>
          </Filtro>
        </div>
        <div role="tablist" aria-label="Informe" className="flex w-full gap-1 rounded-lg bg-hundido p-1 md:w-fit">
          {([['cierre', 'Cierre mensual'], ['costos', 'Costos y desvíos']] as const).map(([id, etiqueta]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={vista === id}
              onClick={() => cambiar('vista', id === 'cierre' ? null : id)}
              className={cx(
                'h-10 flex-1 rounded-md px-4 text-sm font-semibold whitespace-nowrap transition-colors md:flex-none',
                vista === id ? 'bg-superficie text-tinta shadow-tarjeta' : 'text-tenue hover:text-tinta',
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {empresas.isError || actual.isError ? (
        <ErrorState
          titulo="No se pudo cargar el informe."
          descripcion="Revisá la conexión y probá de nuevo."
          accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void (empresas.isError ? empresas.refetch() : actual.refetch())}>Reintentar</Button>}
        />
      ) : empresas.data && empresas.data.length === 0 ? (
        <EmptyState
          titulo="No tenés alcance sobre ninguna razón social completa."
          descripcion="Pedile a gerencia que te asigne una razón social para ver sus informes."
        />
      ) : vista === 'cierre' ? (
        !cierre.data ? <Cargando etiqueta="Calculando el cierre…" /> : <Cierre filas={cierre.data} mes={mes} unaEmpresa={!!empresa} />
      ) : !costos.data ? (
        <Cargando etiqueta="Calculando costos…" />
      ) : (
        <Costos filas={costos.data} mes={mes} />
      )}
    </div>
  )
}

function Cierre({ filas, mes, unaEmpresa }: { filas: CierreMensual[]; mes: string; unaEmpresa: boolean }) {
  const f = unaEmpresa ? filas[0] : undefined
  return (
    <div className="flex flex-col gap-6">
      {f && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi titulo="Saldo inicial" valor={<Importe cents={f.saldo_inicial} />} detalle={`Al 1° de ${etiquetaMes(mes).toLowerCase()}`} />
          <Kpi titulo="Cargas" tono="disponible" valor={<Importe cents={f.cargas} />} detalle="Fondos ingresados en el mes" />
          <Kpi titulo="Pagos" tono="comprometido" valor={<Importe cents={f.pagos} />} detalle="Pagos de trámites en el mes" />
          <Kpi
            titulo="Saldo final"
            tono={negativo(f.saldo_final) ? 'sinfondos' : 'destacado'}
            valor={<Importe cents={f.saldo_final} />}
            detalle={`${f.movimientos} ${f.movimientos === 1 ? 'movimiento' : 'movimientos'} en el mes`}
          />
        </div>
      )}
      <section aria-label="Detalle del cierre" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Cierre de {etiquetaMes(mes).toLowerCase()}</h2>
          <p className="text-[13px] text-tenue">Saldo final = inicial + cargas − pagos + ajustes + reintegros + reversiones</p>
        </div>
        {filas.length > 0 && filas.every((c) => c.movimientos === 0) && (
          <p role="status" className="rounded-md bg-hundido px-4 py-3 text-sm text-tenue">
            Sin movimientos en {etiquetaMes(mes).toLowerCase()}: no se registraron cargas, pagos ni ajustes.
          </p>
        )}
        <DataTable aria-label="Cierre mensual" className="min-w-[960px] [&_th]:whitespace-nowrap">
          <thead>
            <tr>
              <th>Razón social</th>
              <th className="!text-right">Saldo inicial</th>
              <th className="!text-right">Cargas</th>
              <th className="!text-right">Pagos</th>
              <th className="!text-right">Ajustes</th>
              <th className="!text-right">Reintegros</th>
              <th className="!text-right">Reversiones</th>
              <th className="!text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.cuenta_id}>
                <td className={celdaPrincipal}>
                  {c.empresa}
                  <span className="block text-[12px] font-normal text-tenue">{c.movimientos} mov.</span>
                </td>
                <td className={cx(celdaMonto, 'text-tenue')}>{formatearPesos(c.saldo_inicial)}</td>
                <td className={cx(celdaMonto, tono(c.cargas, 'text-disponible'))}>{formatearPesos(c.cargas)}</td>
                <td className={cx(celdaMonto, tono(c.pagos, 'text-comprometido'))}>{formatearPesos(c.pagos)}</td>
                <td className={cx(celdaMonto, tono(c.ajustes, 'text-tinta'))}>{formatearPesos(c.ajustes)}</td>
                <td className={cx(celdaMonto, tono(c.reintegros, 'text-tinta'))}>{formatearPesos(c.reintegros)}</td>
                <td className={cx(celdaMonto, tono(c.reversiones, 'text-tinta'))}>{formatearPesos(c.reversiones)}</td>
                <td className={cx(celdaMonto, 'font-semibold', negativo(c.saldo_final) ? 'text-sinfondos' : tono(c.saldo_final, 'text-tinta'))}>
                  {formatearPesos(c.saldo_final)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
    </div>
  )
}

function Costos({ filas, mes }: { filas: CostoTramite[]; mes: string }) {
  if (!filas.length)
    return (
      <EmptyState
        titulo={`No hubo pagos de trámites en ${etiquetaMes(mes)}`}
        descripcion="El costo se imputa al mes de la fecha de operación de cada pago. Probá con otro mes o razón social."
      />
    )
  return (
    <section aria-label="Costos por trámite" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {filas.length} {filas.length === 1 ? 'trámite con pagos' : 'trámites con pagos'} en {etiquetaMes(mes).toLowerCase()}
        </h2>
        <p className="text-[13px] text-tenue">El desvío compara todo lo pagado contra el último presupuesto, una vez hecho el pago final.</p>
      </div>
      <div className="hidden lg:block">
        <DataTable aria-label="Costos por trámite" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead>
            <tr>
              <th>Trámite</th>
              <th>Tipo y razón social</th>
              <th>Estado</th>
              <th className="!text-right">Presupuesto</th>
              <th className="!text-right">Costo del mes</th>
              <th className="!text-right">Pagado total</th>
              <th className="!text-right">Desvío</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.tramite_id}>
                <td className={celdaPrincipal}>
                  <span className="cifra">{f.numero}</span>
                  <span className="block max-w-44 truncate text-[12px] font-normal text-tenue">{f.cliente}</span>
                </td>
                <td>
                  <span className="block max-w-56 truncate">{f.tipo}</span>
                  <span className="block max-w-56 truncate text-[12px] text-tenue">{f.empresa} · {f.gestora ?? 'Sin gestora'}</span>
                </td>
                <td><ChipEstado estado={f.estado} etiqueta={etiquetaEstado(f.estado)} /></td>
                <td className={cx(celdaMonto, 'text-tenue')}>{f.presupuesto ? formatearPesos(f.presupuesto) : '—'}</td>
                <td className={cx(celdaMonto, 'text-tinta')} data-testid="costo-mes">{formatearPesos(f.costo_mes)}</td>
                <td className={celdaMonto}>{formatearPesos(f.pagado_total)}</td>
                <td className="text-right" data-testid="desvio"><Desvio f={f} /></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
      <ul aria-label="Costos por trámite (lista)" className="flex flex-col gap-3 lg:hidden">
        {filas.map((f) => (
          <li key={f.tramite_id} className="flex flex-col gap-3 rounded-lg bg-superficie p-4 ring-1 ring-linea">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="cifra font-semibold text-tinta">{f.numero}</p>
                <p className="truncate text-[13px] text-tenue">{f.cliente} · {f.tipo}</p>
              </div>
              <ChipEstado estado={f.estado} etiqueta={etiquetaEstado(f.estado)} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-tenue">Presupuesto</dt>
              <dd className="cifra text-right">{f.presupuesto ? formatearPesos(f.presupuesto) : '—'}</dd>
              <dt className="text-tenue">Costo del mes</dt>
              <dd className="cifra text-right font-semibold text-tinta">{formatearPesos(f.costo_mes)}</dd>
              <dt className="text-tenue">Pagado total</dt>
              <dd className="cifra text-right">{formatearPesos(f.pagado_total)}</dd>
            </dl>
            <div className="flex items-center justify-between gap-2 border-t border-linea pt-3">
              <span className="text-[12px] text-tenue">{f.empresa}</span>
              <Desvio f={f} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Desvio({ f }: { f: CostoTramite }) {
  if (f.desvio == null) return <Chip tono="apagado" punto={false} className="!no-underline">Sin pago final</Chip>
  return (
    <Chip tono={tonoDesvio(f.desvio)} className="cifra">
      {formatearPesos(f.desvio)}
      {f.desvio_pct != null && <span className="opacity-75">· {formatearPct(f.desvio_pct)}</span>}
    </Chip>
  )
}
