import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { formatearPesos } from '../lib/dinero'
import { exportarPlanilla, type Columna } from '../lib/planilla'
import { useSesion } from '../lib/sesion'
import { listarSaldos } from '../features/habitualista/consultas'
import { cargarCatalogos } from '../features/tramites/consultas'
import { hoyEnBuenosAires } from '../features/tramites/filtros'
import { obtenerAnalisis, type Analisis as DatosAnalisis } from '../features/analisis/consultas'
import { ETIQUETA_CONCEPTO, PERIODOS, aNumero, etiquetaSemana, etiquetaVariacion, rangoPeriodo, type Periodo } from '../features/analisis/formato'
import { GraficoDona, GraficoLineas } from '../features/analisis/Graficos'
import { Prevision } from '../features/analisis/Prevision'
import { Parametros } from '../features/analisis/Parametros'
import { TablasValuaciones } from '../features/analisis/ImportarValuaciones'
import { Button, Cargando, EmptyState, ErrorState, KpiTile, MenuExportar, PageHeader, claseControl, cx } from '../ui'

type Vista = 'gasto' | 'prevision' | 'parametros'
const VISTAS: [Vista, string][] = [['gasto', 'Gasto real'], ['prevision', 'Previsión de fondos'], ['parametros', 'Parámetros']]

function Filtro({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="rotulo">{etiqueta}</span>
      {children}
    </label>
  )
}

interface FilaReporte { seccion: string; concepto: string; importe: string | null; cantidad: string | null }

function filasReporte(a: DatosAnalisis): FilaReporte[] {
  const k = a.kpis
  const filas: FilaReporte[] = [
    { seccion: 'Indicadores', concepto: 'Gasto real del período', importe: k.gasto_cents, cantidad: null },
    { seccion: 'Indicadores', concepto: 'Gasto del período anterior', importe: k.gasto_anterior_cents, cantidad: null },
    { seccion: 'Indicadores', concepto: 'Estimado pendiente', importe: k.estimado_pendiente_cents, cantidad: null },
    { seccion: 'Indicadores', concepto: 'Honorarios', importe: k.honorarios_cents, cantidad: null },
    { seccion: 'Trámites', concepto: 'Patentamientos 0 km', importe: null, cantidad: String(k.tramites.patentamiento_0km) },
    { seccion: 'Trámites', concepto: 'Transferencias', importe: null, cantidad: String(k.tramites.transferencia_usado) },
    { seccion: 'Trámites', concepto: 'Usados en parte de pago', importe: null, cantidad: String(k.tramites.transferencia_parte_pago) },
  ]
  for (const p of a.por_tipo) filas.push({ seccion: 'Por tipo de trámite', concepto: p.etiqueta, importe: p.cents, cantidad: null })
  for (const p of a.por_empresa) filas.push({ seccion: 'Por razón social', concepto: p.etiqueta, importe: p.cents, cantidad: null })
  for (const p of a.por_concepto) filas.push({ seccion: 'Por concepto', concepto: ETIQUETA_CONCEPTO[p.etiqueta] ?? p.etiqueta, importe: p.cents, cantidad: null })
  for (const s of a.serie) filas.push({ seccion: a.granularidad === 'dia' ? 'Gasto diario' : 'Gasto semanal', concepto: s.fecha, importe: s.gasto_cents, cantidad: null })
  return filas
}

const COLUMNAS: Columna<FilaReporte>[] = [
  { titulo: 'Sección', valor: (f) => f.seccion, ancho: 22 },
  { titulo: 'Concepto', valor: (f) => f.concepto, ancho: 32 },
  { titulo: 'Importe', valor: (f) => f.importe, moneda: true, ancho: 18 },
  { titulo: 'Cantidad', valor: (f) => f.cantidad, ancho: 10 },
]

export function Analisis() {
  const hoy = hoyEnBuenosAires()
  const { rol } = useSesion()
  const [params, setParams] = useSearchParams()
  const vista: Vista = (VISTAS.find(([v]) => v === params.get('vista'))?.[0]) ?? 'gasto'
  const periodo: Periodo = (PERIODOS.find((p) => p.id === params.get('periodo'))?.id) ?? 'mes'
  const empresas = useQuery({ queryKey: ['habitualista', 'saldos'], queryFn: listarSaldos })
  const catalogos = useQuery({ queryKey: ['catalogos'], queryFn: cargarCatalogos, staleTime: Infinity })
  const empresa = empresas.data?.some((e) => e.empresa_id === params.get('empresa')) ? params.get('empresa') : null
  const sucursal = catalogos.data?.sucursales.some((s) => s.id === params.get('sucursal')) ? params.get('sucursal') : null
  const tipo = catalogos.data?.tipos.some((t) => t.codigo === params.get('tipo')) ? params.get('tipo') : null
  const rango = rangoPeriodo(periodo, hoy)

  const cambiar = (clave: string, valor: string | null) => {
    const p = new URLSearchParams(params)
    if (valor) p.set(clave, valor)
    else p.delete(clave)
    setParams(p, { replace: true })
  }

  const q = useQuery({
    queryKey: ['analisis', 'gastos', rango, empresa, sucursal, tipo],
    queryFn: () => obtenerAnalisis({ ...rango, empresa, sucursal, tipo }),
    enabled: vista === 'gasto' && !!empresas.data,
    placeholderData: keepPreviousData,
  })

  const exportar = async (formato: 'csv' | 'xlsx') => {
    if (!q.data) return
    await exportarPlanilla(formato, COLUMNAS, filasReporte(q.data), { hoy, prefijo: `analisis-${rango.desde}-${rango.hasta}`, hoja: 'Análisis' })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo="Uso interno · gerencia y contable"
        titulo="Análisis"
        descripcion="Cuánto se gasta de verdad en trámites, en qué y cuándo, y cuántos fondos van a hacer falta en las próximas semanas."
        acciones={vista === 'gasto' && (
          <div className="flex gap-2 print:hidden">
            <Button variante="secundario" disabled={!q.data} onClick={() => window.print()}>Imprimir o PDF</Button>
            <MenuExportar disabled={!q.data} title="Descarga el reporte con los filtros aplicados" onExportar={exportar} />
          </div>
        )}
      />

      <div className="mb-6 flex flex-col gap-4 rounded-lg bg-superficie p-4 ring-1 ring-linea print:hidden">
        <div role="tablist" aria-label="Sección del análisis" className="flex w-full gap-1 overflow-x-auto rounded-lg bg-hundido p-1 md:w-fit">
          {VISTAS.map(([id, etiqueta]) => (
            <button
              key={id} type="button" role="tab" aria-selected={vista === id}
              onClick={() => cambiar('vista', id === 'gasto' ? null : id)}
              className={cx('h-10 flex-1 rounded-md px-4 text-sm font-semibold whitespace-nowrap transition-colors md:flex-none',
                vista === id ? 'bg-superficie text-tinta shadow-tarjeta' : 'text-tenue hover:text-tinta')}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        {vista !== 'parametros' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {vista === 'gasto' && (
              <Filtro etiqueta="Período">
                <select value={periodo} onChange={(e) => cambiar('periodo', e.target.value === 'mes' ? null : e.target.value)} className={cx(claseControl, 'font-semibold')}>
                  {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
                </select>
              </Filtro>
            )}
            <Filtro etiqueta="Razón social">
              <select value={empresa ?? ''} onChange={(e) => cambiar('empresa', e.target.value || null)} className={cx(claseControl, 'font-semibold')} disabled={!empresas.data}>
                <option value="">Todas</option>
                {empresas.data?.map((e) => <option key={e.empresa_id} value={e.empresa_id}>{e.empresa}</option>)}
              </select>
            </Filtro>
            {vista === 'gasto' && (
              <>
                <Filtro etiqueta="Sucursal">
                  <select value={sucursal ?? ''} onChange={(e) => cambiar('sucursal', e.target.value || null)} className={cx(claseControl, 'font-semibold')} disabled={!catalogos.data}>
                    <option value="">Todas</option>
                    {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </Filtro>
                <Filtro etiqueta="Tipo de trámite">
                  <select value={tipo ?? ''} onChange={(e) => cambiar('tipo', e.target.value || null)} className={cx(claseControl, 'font-semibold')} disabled={!catalogos.data}>
                    <option value="">Todos</option>
                    {catalogos.data?.tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
                  </select>
                </Filtro>
              </>
            )}
          </div>
        )}
      </div>

      {empresas.isError ? (
        <ErrorState titulo="No se pudo cargar el análisis." accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void empresas.refetch()}>Reintentar</Button>} />
      ) : empresas.data && empresas.data.length === 0 ? (
        <EmptyState titulo="No tenés alcance sobre ninguna razón social completa." descripcion="Pedile a gerencia que te asigne una razón social para ver su análisis." />
      ) : vista === 'prevision' ? (
        <Prevision hoy={hoy} empresa={empresa} />
      ) : vista === 'parametros' ? (
        <>
          <Parametros hoy={hoy} editable={rol === 'gerencia'} />
          <TablasValuaciones editable={rol === 'gerencia'} />
        </>
      ) : q.isError ? (
        <ErrorState titulo="No se pudo calcular el gasto." accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void q.refetch()}>Reintentar</Button>} />
      ) : !q.data ? (
        <Cargando etiqueta="Calculando el gasto…" />
      ) : (
        <Gasto a={q.data} />
      )}
    </div>
  )
}

function Gasto({ a }: { a: DatosAnalisis }) {
  const k = a.kpis
  const t = k.tramites
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <section aria-label="Gasto real"><KpiTile rotulo="Gasto real" tono="destacado" grande valor={formatearPesos(k.gasto_cents)} detalle={etiquetaVariacion(k.variacion_pct)} className="h-full" /></section>
        <section aria-label="Estimado pendiente"><KpiTile rotulo="Estimado pendiente" tono="comprometido" valor={formatearPesos(k.estimado_pendiente_cents)} detalle="Trámites en curso todavía sin presupuesto" className="h-full" /></section>
        <section aria-label="Trámites"><KpiTile rotulo="Trámites ingresados" valor={String(t.patentamiento_0km + t.transferencia_usado + t.transferencia_parte_pago)} detalle={`${t.patentamiento_0km} 0 km · ${t.transferencia_usado} transferencias · ${t.transferencia_parte_pago} usados en parte de pago`} className="h-full" /></section>
        <section aria-label="Honorarios"><KpiTile rotulo="Honorarios" valor={formatearPesos(k.honorarios_cents)} detalle="Según las rendiciones del período" className="h-full" /></section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GraficoLineas
          titulo={a.granularidad === 'dia' ? 'Gasto diario' : 'Gasto semanal'}
          datos={a.serie.map((s) => ({ fecha: etiquetaSemana(s.fecha), gasto: aNumero(s.gasto_cents) }))}
          x="fecha" series={[{ clave: 'gasto', nombre: 'Gasto' }]} vacio="Sin pagos en el período."
        />
        <GraficoLineas
          titulo="Trámites por semana"
          datos={a.semanas.map((s) => ({ semana: etiquetaSemana(s.semana), tramites: s.tramites }))}
          x="semana" series={[{ clave: 'tramites', nombre: 'Trámites' }]} moneda={false} vacio="No ingresaron trámites en el período."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <GraficoDona titulo="Gasto por tipo de trámite" porciones={a.por_tipo} etiqueta={(x) => x} />
        <GraficoDona titulo="Gasto por razón social" porciones={a.por_empresa} etiqueta={(x) => x} />
        <GraficoDona titulo="Gasto por concepto" porciones={a.por_concepto} etiqueta={(x) => ETIQUETA_CONCEPTO[x] ?? x} />
      </div>
    </div>
  )
}
