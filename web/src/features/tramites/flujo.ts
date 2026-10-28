// Recorrido de un trámite y acciones de oficina (gerencia/contable) según transicion_permitida (spec D).
import type { Evento } from './consultas'

/** Pasos del camino feliz, en orden, para el indicador de avance del detalle. */
export const PASOS = [
  { id: 'borrador', etiqueta: 'Alta' },
  { id: 'autorizado', etiqueta: 'Autorizado' },
  { id: 'presentado', etiqueta: 'Presentado' },
  { id: 'finalizado_registro', etiqueta: 'Finalizado' },
  { id: 'devuelto', etiqueta: 'Devuelto' },
  { id: 'cerrado', etiqueta: 'Cerrado' },
] as const

/** Índice del paso alcanzado (observado cuenta como alta; en gestoría como autorizado). -1 si salió del camino. */
export function indicePaso(estado: string): number {
  const alias: Record<string, string> = { observado: 'borrador', en_gestoria: 'autorizado' }
  return PASOS.findIndex((p) => p.id === (alias[estado] ?? estado))
}

export const ESTADOS_TERMINALES = ['cerrado', 'cancelado', 'rechazado']

/** Avance normal disponible para la oficina desde cada estado (sin autorizar, que tiene su propio flujo). */
export const AVANCE: Record<string, { hacia: string; etiqueta: string }> = {
  observado: { hacia: 'borrador', etiqueta: 'Volver a borrador' },
  autorizado: { hacia: 'presentado', etiqueta: 'Marcar presentado' },
  en_gestoria: { hacia: 'presentado', etiqueta: 'Marcar presentado' },
  presentado: { hacia: 'finalizado_registro', etiqueta: 'Finalizado en registro' },
  finalizado_registro: { hacia: 'devuelto', etiqueta: 'Marcar devuelto' },
  devuelto: { hacia: 'cerrado', etiqueta: 'Cerrar trámite' },
}

export const puedeRechazar = (estado: string) => estado === 'borrador'
export const puedeSuspender = (estado: string) => !ESTADOS_TERMINALES.includes(estado) && estado !== 'suspendido'
export const puedeCancelar = (estado: string) => !ESTADOS_TERMINALES.includes(estado)

/** Estado al que vuelve un trámite suspendido: el "antes" de la última suspensión (eventos más nuevos primero). */
export function estadoPrevioSuspension(eventos: Evento[]): string | null {
  const e = eventos.find((x) => x.entidad === 'tramites' && x.estado_despues === 'suspendido' && x.estado_antes !== 'suspendido')
  return e?.estado_antes ?? null
}
