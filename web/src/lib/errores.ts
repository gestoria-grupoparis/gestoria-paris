import { etiquetaEstado } from '../features/tramites/filtros'

export const CODIGOS_ERROR = [
  'SIN_PERMISO',
  'VERSION_CONFLICTO',
  'TRANSICION_INVALIDA',
  'DUPLICADO',
  'EMPRESA_DISTINTA',
  'NO_AUTORIZADO',
  'DATO_INVALIDO',
  'NO_ENCONTRADO',
] as const

export type CodigoError = (typeof CODIGOS_ERROR)[number]

const MENSAJES: Record<CodigoError, string> = {
  SIN_PERMISO: 'No tenés permiso para realizar esta acción.',
  VERSION_CONFLICTO: 'Otro usuario modificó este trámite. Recargá para ver los cambios.',
  TRANSICION_INVALIDA: 'El trámite no puede pasar a ese estado desde el estado actual.',
  DUPLICADO: 'Ya existe un registro con esos datos.',
  EMPRESA_DISTINTA: 'La operación mezcla datos de distintas razones sociales.',
  NO_AUTORIZADO: 'Todavía no se puede hacer este paso.',
  DATO_INVALIDO: 'Hay datos inválidos. Revisá el formulario.',
  NO_ENCONTRADO: 'No se encontró el registro solicitado.',
}

const GENERICO = 'Ocurrió un error inesperado. Intentá de nuevo.'
export const SIN_CONEXION = 'No hay conexión. Revisá internet y volvé a intentar.'
export const SESION_VENCIDA = 'Tu sesión venció. Volvé a ingresar.'

const ESTADOS_CRUDOS = [
  'borrador', 'autorizado', 'en_gestoria', 'presentado', 'observado', 'devuelto',
  'finalizado_registro', 'finalizado', 'cerrado', 'cancelado', 'suspendido', 'sin_fondos',
]

function texto(e: unknown, campo: 'message' | 'code' | 'name'): string {
  return e && typeof e === 'object' && campo in e && typeof (e as Record<string, unknown>)[campo] === 'string'
    ? ((e as Record<string, unknown>)[campo] as string)
    : ''
}

export function codigoError(e: unknown): CodigoError | null {
  const m = /^([A-Z_]+):/.exec(texto(e, 'message'))
  return m && (CODIGOS_ERROR as readonly string[]).includes(m[1]) ? (m[1] as CodigoError) : null
}

export function esErrorRed(e: unknown): boolean {
  const msg = texto(e, 'message')
  return texto(e, 'name') === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|Load failed/i.test(msg)
}

export function esSesionVencida(e: unknown): boolean {
  return texto(e, 'code') === 'PGRST301' || /invalid JWT|JWT expired/i.test(texto(e, 'message'))
}

function humanizar(detalle: string): string {
  let d = detalle.trim()
  for (const est of ESTADOS_CRUDOS) {
    const et = etiquetaEstado(est)
    if (et && et !== est) d = d.replace(new RegExp(`(^|[^a-z_])${est}(?![a-z_])`, "g"), `$1${et}`)
  }
  d = d.charAt(0).toUpperCase() + d.slice(1)
  return /[.!?]$/.test(d) ? d : `${d}.`
}

export function mensajeError(e: unknown): string {
  const codigo = codigoError(e)
  if (codigo) {
    const detalle = texto(e, 'message').slice(codigo.length + 1).trim()
    return detalle && codigo !== "VERSION_CONFLICTO" ? humanizar(detalle) : MENSAJES[codigo]
  }
  if (esErrorRed(e)) return SIN_CONEXION
  if (esSesionVencida(e)) return SESION_VENCIDA
  const pg = texto(e, 'code')
  if (pg === '23505') return MENSAJES.DUPLICADO
  if (pg === '23514') return MENSAJES.DATO_INVALIDO
  return GENERICO
}
