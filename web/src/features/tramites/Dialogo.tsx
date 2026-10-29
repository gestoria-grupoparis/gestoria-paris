import { claseControl } from '../../ui'

// Clases heredadas: otras pantallas todavía las usan; ahora apuntan al estilo del kit.
export const CLASE_CAMPO = `mt-1.5 ${claseControl}`
export const CLASE_ETIQUETA = 'block text-[13px] font-semibold text-tinta'
export const CLASE_PRIMARIO =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-marca px-4 text-[14px] font-semibold text-superficie shadow-tarjeta transition-colors hover:bg-marca-hover disabled:cursor-not-allowed disabled:opacity-55'
export const CLASE_SECUNDARIO =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-superficie px-4 text-[14px] font-semibold text-tinta ring-1 ring-inset ring-linea-fuerte transition-colors hover:bg-hundido disabled:cursor-not-allowed disabled:opacity-55'

export { Dialogo } from '../../ui/Dialogo'
