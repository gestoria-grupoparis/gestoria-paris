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
  NO_AUTORIZADO: 'El trámite todavía no está autorizado.',
  DATO_INVALIDO: 'Hay datos inválidos. Revisá el formulario.',
  NO_ENCONTRADO: 'No se encontró el registro solicitado.',
}

const GENERICO = 'Ocurrió un error inesperado. Intentá de nuevo.'

export function codigoError(e: unknown): CodigoError | null {
  const msg =
    e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' ? e.message : ''
  const m = /^([A-Z_]+):/.exec(msg)
  return m && (CODIGOS_ERROR as readonly string[]).includes(m[1]) ? (m[1] as CodigoError) : null
}

export function mensajeError(e: unknown): string {
  const codigo = codigoError(e)
  return codigo ? MENSAJES[codigo] : GENERICO
}
