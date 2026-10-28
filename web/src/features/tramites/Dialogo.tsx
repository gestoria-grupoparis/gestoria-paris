import { useEffect, useId, useRef, type ReactNode } from 'react'
import { claseControl } from '../../ui'
import { IconoCerrar } from '../../ui/Iconos'

// Clases heredadas: otras pantallas todavía las usan; ahora apuntan al estilo del kit.
export const CLASE_CAMPO = `mt-1.5 ${claseControl}`
export const CLASE_ETIQUETA = 'block text-[13px] font-semibold text-tinta'
export const CLASE_PRIMARIO =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-marca px-4 text-[14px] font-semibold text-superficie shadow-tarjeta transition-colors hover:bg-marca-hover disabled:cursor-not-allowed disabled:opacity-55'
export const CLASE_SECUNDARIO =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-superficie px-4 text-[14px] font-semibold text-tinta ring-1 ring-inset ring-linea-fuerte transition-colors hover:bg-hundido disabled:cursor-not-allowed disabled:opacity-55'

/**
 * Diálogo modal: hoja inferior en el teléfono, tarjeta centrada en escritorio.
 * Título accesible, Escape cierra, foco inicial en el primer campo.
 */
export function Dialogo({
  titulo,
  rotulo,
  onCerrar,
  children,
  ancho = 'md:max-w-lg',
}: {
  titulo: string
  rotulo?: ReactNode
  onCerrar: () => void
  children: ReactNode
  ancho?: string
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,select,textarea')?.focus()
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-noche/55 md:items-center md:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-superficie shadow-flotante md:rounded-xl ${ancho}`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-linea bg-superficie/95 px-5 pt-5 pb-4 backdrop-blur md:px-6">
          <div>
            {rotulo && <div className="rotulo mb-1">{rotulo}</div>}
            <h2 id={id} className="text-[22px] leading-tight font-semibold">
              {titulo}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCerrar}
            className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-md text-tenue hover:bg-hundido hover:text-tinta"
          >
            <IconoCerrar />
          </button>
        </div>
        <div className="px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">{children}</div>
      </div>
    </div>
  )
}
