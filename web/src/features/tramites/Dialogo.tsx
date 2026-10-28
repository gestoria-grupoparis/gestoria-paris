import { useEffect, useId, useRef, type ReactNode } from 'react'

export const CLASE_CAMPO =
  'mt-0.5 w-full border border-linea bg-white px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-marca'
export const CLASE_ETIQUETA = 'block text-xs font-medium text-tenue'
export const CLASE_PRIMARIO =
  'bg-marca px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
export const CLASE_SECUNDARIO =
  'border border-linea bg-white px-3 py-1.5 text-sm font-medium hover:bg-fondo focus-visible:outline-2 focus-visible:outline-marca'

/** Diálogo modal mínimo: título accesible, Escape cierra, foco inicial en el primer campo. */
export function Dialogo({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-tinta/40 md:items-center">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="max-h-dvh w-full overflow-y-auto border border-linea bg-white p-4 md:max-w-lg"
      >
        <h2 id={id} className="mb-3 text-base font-semibold">
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  )
}
