import { cx } from './cx'

/** Dominio con aspecto de patente Mercosur: franja azul arriba, tipografía mono espaciada. */
export function Patente({ dominio, className }: { dominio: string; className?: string }) {
  return (
    <span className={cx('inline-flex flex-col overflow-hidden rounded-[5px] bg-white align-middle ring-1 ring-tinta/70', className)}>
      <span aria-hidden className="h-[5px] bg-info" />
      <span className="px-1.5 pt-px pb-0.5 font-mono text-[12px] leading-none font-semibold tracking-[0.12em] text-tinta">{dominio}</span>
    </span>
  )
}
