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

/** Un paso atrás para corregir un clic equivocado (con motivo; ver es_retroceso en la base). */
export const RETROCESO: Record<string, { hacia: string; etiqueta: string }> = {
  en_gestoria: { hacia: 'autorizado', etiqueta: 'Volver a autorizado' },
  presentado: { hacia: 'autorizado', etiqueta: 'Volver a sin presentar' },
  finalizado_registro: { hacia: 'presentado', etiqueta: 'Volver a presentado' },
  devuelto: { hacia: 'finalizado_registro', etiqueta: 'Volver a finalizado' },
  cerrado: { hacia: 'devuelto', etiqueta: 'Reabrir trámite' },
}

export const puedeRechazar = (estado: string) => estado === 'borrador'
export const puedeSuspender = (estado: string) => !ESTADOS_TERMINALES.includes(estado) && estado !== 'suspendido'
export const puedeCancelar = (estado: string) => !ESTADOS_TERMINALES.includes(estado)

/** Todos los estados del trámite (mismo check de la tabla tramites). */
export const TODOS_LOS_ESTADOS = [
  'borrador', 'observado', 'autorizado', 'en_gestoria', 'presentado', 'finalizado_registro',
  'devuelto', 'cerrado', 'suspendido', 'cancelado', 'rechazado',
] as const

/**
 * Destinos que la oficina (gerencia/contable) tiene como botón desde cada estado.
 * 'autorizado' desde borrador va por autorizar_tramite; 'previo' es reanudar_tramite.
 */
export function accionesOficina(estado: string): string[] {
  const r: string[] = []
  if (estado === 'borrador') r.push('autorizado', 'observado')
  if (AVANCE[estado]) r.push(AVANCE[estado].hacia)
  if (RETROCESO[estado]) r.push(RETROCESO[estado].hacia)
  if (puedeRechazar(estado)) r.push('rechazado')
  if (puedeSuspender(estado)) r.push('suspendido')
  if (estado === 'suspendido') r.push('previo')
  if (puedeCancelar(estado)) r.push('cancelado')
  return [...new Set(r)]
}

/** Estados que caen en cada grupo de la gestora (ver grupoDe en features/gestora/consultas). */
export const ESTADOS_POR_GRUPO: Record<string, string[]> = {
  presupuestar: ['autorizado', 'en_gestoria', 'presentado'],
  aprobacion: ['autorizado', 'en_gestoria'],
  listos: ['autorizado', 'en_gestoria'],
  presentados: ['presentado'],
  devolver: ['finalizado_registro'],
  devueltos: ['devuelto'],
}

/** Cambios de estado que la tarjeta de la gestora ofrece (avance y deshacer) en cada grupo. */
export function accionesGestora(grupo: string, retirado: boolean): string[] {
  if (grupo === 'listos') return retirado ? ['presentado'] : []
  if (grupo === 'presentados') return ['finalizado_registro', 'autorizado']
  if (grupo === 'devolver') return ['devuelto', 'presentado']
  if (grupo === 'devueltos') return ['finalizado_registro']
  return []
}

/** Estado al que vuelve un trámite suspendido: el "antes" de la última suspensión (eventos más nuevos primero). */
export function estadoPrevioSuspension(eventos: Evento[]): string | null {
  const e = eventos.find((x) => x.entidad === 'tramites' && x.estado_despues === 'suspendido' && x.estado_antes !== 'suspendido')
  return e?.estado_antes ?? null
}

// --- Edición y dinero desde el panel (contable y gerencia) -------------------------------------
const EN_CURSO = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro']

/** editar_tramite acepta borradores y observados. */
export const puedeEditar = (estado: string) => estado === 'borrador' || estado === 'observado'
/** registrar_presupuesto acepta autorizado, en gestoría o presentado. */
export const puedePresupuestar = (estado: string) => ['autorizado', 'en_gestoria', 'presentado'].includes(estado)
/** R24: pagar fuera de curso es una excepción de oficina y exige motivo. */
export const pagoEsExcepcion = (estado: string) => !EN_CURSO.includes(estado)
/** Regla 17: solo gerencia libera un trámite sin fondos. */
export const puedeAprobarExcepcion = (rol: string | null, situacion: string | null | undefined) =>
  rol === 'gerencia' && situacion === 'sin_fondos'

const MOVIMIENTOS: Record<string, string> = { reintegro: 'Reintegro', reversion: 'Reversión', ajuste: 'Ajuste', carga: 'Carga' }
export const etiquetaMovimiento = (tipo: string, esFinal: boolean) =>
  tipo === 'pago_tramite' ? (esFinal ? 'Pago final' : 'Pago') : (MOVIMIENTOS[tipo] ?? tipo)

// --- Selección de filas (reasignación en lote, caso K) ------------------------------------------
export function alternar(sel: Set<string>, id: string): Set<string> {
  const n = new Set(sel)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}

/** Si ya están todas las visibles, las quita; si no, las agrega. */
export function alternarTodas(sel: Set<string>, visibles: string[]): Set<string> {
  const todas = visibles.length > 0 && visibles.every((id) => sel.has(id))
  const n = new Set(sel)
  for (const id of visibles) {
    if (todas) n.delete(id)
    else n.add(id)
  }
  return n
}
