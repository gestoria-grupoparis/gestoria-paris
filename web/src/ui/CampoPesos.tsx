import { forwardRef, type InputHTMLAttributes } from 'react'
import { normalizarPesos } from '../lib/dinero'
import { claseControl } from './Field'
import { cx } from './cx'

/**
 * Campo de importe en pesos: teclado decimal, prefijo "$", acepta "1.500,50" o "1500.50" y al salir
 * lo deja con formato argentino. El valor sigue siendo texto: se convierte a centavos con parsearPesos.
 */
export const CampoPesos = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onValor: (v: string) => void }
>(function CampoPesos({ value, onValor, className, onBlur, ...p }, ref) {
  return (
    <span className="relative block">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tenue">$</span>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        {...p}
        value={value}
        onChange={(e) => onValor(e.target.value)}
        onBlur={(e) => {
          onValor(normalizarPesos(e.target.value))
          onBlur?.(e)
        }}
        className={cx(claseControl, 'cifra pl-7', className)}
      />
    </span>
  )
})
