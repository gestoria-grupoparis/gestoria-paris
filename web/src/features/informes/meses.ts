import type { TonoChip } from '../../ui'

// Meses del informe como "YYYY-MM", calculados sobre el texto de la fecha (hora de Argentina),
// sin pasar por Date para no correr el mes por zona horaria.

const NOMBRES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Los últimos `n` meses hasta el de `hoy` (YYYY-MM-DD), del más reciente al más viejo. */
export function mesesRecientes(hoy: string, n: number): string[] {
  let a = Number(hoy.slice(0, 4))
  let m = Number(hoy.slice(5, 7))
  const res: string[] = []
  for (let i = 0; i < n; i++) {
    res.push(`${a}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; a -= 1 }
  }
  return res
}

export function etiquetaMes(mes: string): string {
  return `${NOMBRES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`
}

export function primerDiaDelMes(mes: string): string {
  return `${mes.slice(0, 7)}-01`
}

/** Desvío positivo (se pagó más que el presupuesto) en rojo; ahorro en verde; sin pago final, apagado. */
export function tonoDesvio(desvio: string | null): TonoChip {
  if (desvio == null) return 'apagado'
  if (/^-?0+$/.test(desvio)) return 'neutro'
  return desvio.startsWith('-') ? 'disponible' : 'sinfondos'
}

/** "10.00" (numeric de la base) a "10,00 %" con signo explícito si es positivo. */
export function formatearPct(pct: string): string {
  const [ent, dec = '00'] = pct.split('.')
  return `${ent.startsWith('-') ? '' : '+'}${ent},${dec.padEnd(2, '0').slice(0, 2)} %`
}

/** Importe en centavos igual a cero (texto, sin aritmética). */
export const esCero = (cents: string) => /^-?0+$/.test(cents)
