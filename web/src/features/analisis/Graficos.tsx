// Gráficos del módulo Análisis. Solo líneas (curva suave con puntos) y donas: el dueño no quiere
// barras. Recharts se importa únicamente desde acá, que solo usa la ruta /analisis (chunk lazy).
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatearPesos } from '../../lib/dinero'
import { Card, CardHeader, EmptyState } from '../../ui'
import type { Porcion } from './consultas'
import { aNumero } from './formato'

/** Paleta monocroma con un acento: la marca es negra; el color queda para los estados de dinero. */
const PALETA = ['var(--color-marca)', 'var(--color-acento)', 'var(--color-disponible)', 'var(--color-comprometido)', 'var(--color-tenue)', 'var(--color-plata)']
const pesosCortos = (n: number) => '$ ' + new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const pesos = (n: number) => formatearPesos(Math.round(n * 100))

export interface SerieLinea { clave: string; nombre: string; color?: string; punteada?: boolean }

export function GraficoLineas({
  titulo, rotulo, datos, x, series, moneda = true, vacio,
}: {
  titulo: string
  rotulo?: string
  datos: Record<string, string | number | null>[]
  x: string
  series: SerieLinea[]
  moneda?: boolean
  vacio: string
}) {
  const hayDatos = datos.some((d) => series.some((s) => Number(d[s.clave] ?? 0) !== 0))
  return (
    <Card>
      <CardHeader titulo={titulo} rotulo={rotulo} />
      <figure aria-label={titulo} className="px-2 pt-4 pb-2">
        {hayDatos ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={datos} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="var(--color-linea)" vertical={false} />
                <XAxis dataKey={x} tick={{ fontSize: 12, fill: 'var(--color-tenue)' }} tickLine={false} axisLine={{ stroke: 'var(--color-linea)' }} minTickGap={16} />
                <YAxis
                  tick={{ fontSize: 12, fill: 'var(--color-tenue)' }} tickLine={false} axisLine={false} width={moneda ? 64 : 32}
                  allowDecimals={!moneda ? false : undefined} tickFormatter={moneda ? pesosCortos : undefined}
                />
                <Tooltip
                  formatter={(v) => (moneda ? pesos(Number(v)) : String(v))}
                  contentStyle={{ borderRadius: 6, border: '1px solid var(--color-linea)', fontSize: 13 }}
                />
                {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {series.map((s, i) => (
                  <Line
                    key={s.clave} type="monotone" dataKey={s.clave} name={s.nombre} stroke={s.color ?? PALETA[i]} strokeWidth={2}
                    strokeDasharray={s.punteada ? '5 4' : undefined} dot={{ r: 3, strokeWidth: 0, fill: s.color ?? PALETA[i] }}
                    activeDot={{ r: 5 }} isAnimationActive={false} connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState titulo={vacio} />
        )}
      </figure>
    </Card>
  )
}

export function GraficoDona({ titulo, porciones, etiqueta }: { titulo: string; porciones: Porcion[]; etiqueta: (k: string) => string }) {
  const positivas = porciones.filter((p) => BigInt(p.cents) > 0n)
  const datos = positivas.map((p) => ({ nombre: etiqueta(p.etiqueta), valor: aNumero(p.cents), cents: p.cents }))
  return (
    <Card>
      <CardHeader titulo={titulo} />
      <figure aria-label={titulo} className="px-4 py-4">
        {datos.length ? (
          <>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={datos} dataKey="valor" nameKey="nombre" innerRadius="58%" outerRadius="90%" paddingAngle={1} stroke="var(--color-superficie)" isAnimationActive={false}>
                    {datos.map((d, i) => <Cell key={d.nombre} fill={PALETA[i % PALETA.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => pesos(Number(v))} contentStyle={{ borderRadius: 6, border: '1px solid var(--color-linea)', fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {datos.map((d, i) => (
                <li key={d.nombre} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: PALETA[i % PALETA.length] }} />
                    <span className="truncate">{d.nombre}</span>
                  </span>
                  <span className="cifra font-medium">{formatearPesos(d.cents)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState titulo="Sin gasto en el período." />
        )}
      </figure>
    </Card>
  )
}
