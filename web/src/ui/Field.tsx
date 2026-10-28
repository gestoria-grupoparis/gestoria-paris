import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export const claseControl =
  'h-11 w-full rounded-md border border-linea-fuerte bg-superficie px-3 text-[14px] text-tinta placeholder:text-tenue/70 transition-colors hover:border-tenue/60 focus-visible:border-acento focus-visible:outline-acento/30 aria-[invalid=true]:border-sinfondos'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(claseControl, className)} {...p} />
})

export interface PropsControl {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/** Rótulo + control + ayuda/error. El hijo recibe id y aria-* por render-prop. */
export function Field({
  label,
  id: idFijo,
  ayuda,
  error,
  extra,
  className,
  children,
}: {
  label: string
  /** id fijo del control (opcional; si no, se genera). */
  id?: string
  ayuda?: ReactNode
  error?: string | null
  extra?: ReactNode
  className?: string
  children: (p: PropsControl) => ReactNode
}) {
  const generado = useId()
  const id = idFijo ?? generado
  const desc = error ? `${id}-err` : ayuda ? `${id}-ayuda` : undefined
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-tinta">
          {label}
        </label>
        {extra}
      </div>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="text-[13px] font-medium text-sinfondos">
          {error}
        </p>
      ) : ayuda ? (
        <p id={`${id}-ayuda`} className="text-[13px] text-tenue">
          {ayuda}
        </p>
      ) : null}
    </div>
  )
}
