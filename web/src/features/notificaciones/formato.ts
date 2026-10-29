import type { TonoChip } from '../../ui'

export type TipoNotificacion = 'asignado' | 'observado' | 'sin_fondos' | 'presupuesto_cargado'

export const TIPO_NOTIFICACION: Record<TipoNotificacion, { etiqueta: string; tono: TonoChip }> = {
  asignado: { etiqueta: 'Asignado', tono: 'info' },
  observado: { etiqueta: 'Observado', tono: 'comprometido' },
  sin_fondos: { etiqueta: 'Sin fondos', tono: 'sinfondos' },
  presupuesto_cargado: { etiqueta: 'Presupuesto', tono: 'marca' },
}

export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const seg = Math.max(0, (ahora.getTime() - Date.parse(iso)) / 1000)
  if (seg < 60) return 'recién'
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/** Pantalla a la que lleva una notificación: la gestora trabaja en Mis trámites; el resto abre el panel. */
export function destinoNotificacion(rol: string | null | undefined, tramite: string | null): string | null {
  if (!tramite) return null
  return rol === 'gestora' ? '/mis-tramites' : `/tramites?t=${tramite}`
}

export const noLeidas = (lista: { leida_at: string | null }[]) => lista.filter((n) => !n.leida_at).length
