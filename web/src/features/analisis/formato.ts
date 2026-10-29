// Formato del módulo Análisis. No calcula montos: los totales llegan de la base. Solo arma fechas
// de filtro y convierte centavos a número para ubicar los puntos de los gráficos.

export type Periodo = 'mes' | 'mes_anterior' | '30d' | '90d'

export const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'mes_anterior', etiqueta: 'Mes anterior' },
  { id: '30d', etiqueta: 'Últimos 30 días' },
  { id: '90d', etiqueta: 'Últimos 90 días' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fecha = (s: string) => new Date(`${s}T00:00:00Z`)

export function rangoPeriodo(p: Periodo, hoy: string): { desde: string; hasta: string } {
  const h = fecha(hoy)
  const y = h.getUTCFullYear()
  const m = h.getUTCMonth()
  if (p === 'mes') return { desde: iso(new Date(Date.UTC(y, m, 1))), hasta: iso(new Date(Date.UTC(y, m + 1, 0))) }
  if (p === 'mes_anterior') return { desde: iso(new Date(Date.UTC(y, m - 1, 1))), hasta: iso(new Date(Date.UTC(y, m, 0))) }
  const dias = p === '30d' ? 30 : 91
  return { desde: iso(new Date(h.getTime() - (dias - 1) * 86_400_000)), hasta: hoy }
}

export function etiquetaVariacion(pct: number | null): string {
  if (pct == null) return 'Sin gasto en el período anterior'
  const t = String(Math.abs(pct)).replace('.', ',')
  return `${pct > 0 ? '+' : pct < 0 ? '-' : ''}${t} % contra el período anterior`
}

export const ETIQUETA_CONCEPTO: Record<string, string> = {
  arancel: 'Arancel DNRPA',
  prenda: 'Prenda',
  sellos: 'Sellos',
  sellos_prenda: 'Sellos de la prenda',
  sellos_acto: 'Sellos del trámite',
  honorarios: 'Honorarios',
  otros: 'Otros',
}

export function etiquetaConfianza(c: string): string {
  if (c === 'completo') return 'Completo: todas las reglas verificadas'
  if (c === 'parcial') return 'Parcial: hay líneas sin dato'
  return 'Sin valor de referencia'
}

/** Centavos (texto) a pesos como número, solo para la escala de los gráficos. */
export function aNumero(cents: string | null | undefined): number {
  return cents == null ? 0 : Number(cents) / 100
}

export const etiquetaSemana = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
