import { cx } from './cx'

/** Placa "GP": badge con forma de patente (franja de latón arriba). */
export function Placa({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative inline-flex h-7 w-10 shrink-0 items-end justify-center overflow-hidden rounded-[6px] bg-marca pb-[3px] font-display text-[13px] font-extrabold leading-none tracking-wide text-superficie ring-1 ring-black/10',
        className,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-[6px] bg-laton" />
      GP
    </span>
  )
}

/** Wordmark "Gestoría · Grupo Paris". tono="claro" para fondos oscuros. */
export function Wordmark({ tono = 'oscuro', className }: { tono?: 'oscuro' | 'claro'; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <Placa />
      <span className="flex flex-col leading-none">
        <span className={cx('font-display text-[19px] font-extrabold tracking-tight', tono === 'claro' ? 'text-superficie' : 'text-tinta')}>
          Gestoría
        </span>
        <span className={cx('mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]', tono === 'claro' ? 'text-laton' : 'text-marca')}>
          Grupo Paris
        </span>
      </span>
    </span>
  )
}
