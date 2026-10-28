import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro'
export type Tamano = 'sm' | 'md' | 'lg'

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca text-superficie hover:bg-marca-hover',
  secundario: 'bg-superficie text-tinta ring-1 ring-inset ring-linea-fuerte hover:bg-hover',
  fantasma: 'text-tinta hover:bg-hundido',
  peligro: 'bg-sinfondos text-white hover:brightness-95',
}
const TAMANOS: Record<Tamano, string> = {
  sm: 'h-9 min-w-9 px-3 text-sm',
  md: 'h-11 px-4 text-[14px]',
  lg: 'h-12 px-5 text-[14px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamano?: Tamano
  icono?: ReactNode
  cargando?: boolean
  ancho?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'primario', tamano = 'md', icono, cargando, ancho, className, children, disabled, type = 'button', ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTES[variante],
        TAMANOS[tamano],
        ancho && 'w-full',
        className,
      )}
      {...resto}
    >
      {cargando ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : icono}
      {children}
    </button>
  )
})
