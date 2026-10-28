// Reglas de presentación de saldos. Los importes llegan como texto en centavos desde v_saldos:
// acá no se suma ni se resta, solo se compara el signo y se elige qué mostrar.

/** Necesidad de recarga = max(−disponible, 0): el faltante cuando el disponible es negativo. */
export function necesidadRecarga(disponible: string): string {
  if (!/^-?\d+$/.test(disponible)) throw new Error(`Importe en centavos inválido: ${disponible}`)
  return disponible.startsWith('-') && !/^-0+$/.test(disponible) ? disponible.slice(1) : '0'
}

/** Días después de los cuales la última conciliación se considera vieja (spec G.2). */
export const DIAS_CONCILIACION = 7

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/** "Sin verificar" (ámbar): no hay conciliación, tiene más de 7 días o la diferencia no es cero. */
export function conciliacionVencida(fecha: string | null, diferencia: string | null, hoy: string): boolean {
  if (!fecha) return true
  if (diferencia != null && !/^-?0+$/.test(diferencia)) return true
  return diasEntre(fecha, hoy) > DIAS_CONCILIACION
}

/** Fecha operativa YYYY-MM-DD a dd/mm/aaaa sin pasar por Date (evita el corrimiento de zona). */
export function fechaOperativa(fecha: string): string {
  const [a, m, d] = fecha.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
