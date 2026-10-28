import type { ReactNode, TableHTMLAttributes } from 'react'
import { cx } from './cx'

const ESTILO_TABLA = [
  'w-full border-separate border-spacing-0 text-[13px]',
  '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:border-b [&_thead_th]:border-linea [&_thead_th]:bg-superficie/95 [&_thead_th]:backdrop-blur',
  '[&_thead_th]:h-9 [&_thead_th]:px-4 [&_thead_th]:text-left [&_thead_th]:text-[12px] [&_thead_th]:font-medium [&_thead_th]:text-tenue',
  '[&_tbody_td]:h-11 [&_tbody_td]:border-b [&_tbody_td]:border-linea [&_tbody_td]:px-4 [&_tbody_td]:py-1.5',
  '[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-hover',
  '[&_tbody_tr[aria-selected=true]]:bg-acento/[0.05] [&_tbody_tr[aria-selected=true]_td:first-child]:shadow-[inset_2px_0_0_var(--color-acento)]',
].join(' ')

/**
 * Envoltorio visual de tabla: tarjeta redondeada, header sticky, filas de 44px con hover.
 * Uso: <DataTable aria-label="Trámites"><thead>…</thead><tbody>…</tbody></DataTable>
 */
export function DataTable({ className, children, pie, ...p }: TableHTMLAttributes<HTMLTableElement> & { pie?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg bg-superficie ring-1 ring-linea">
      <div className="max-h-[70dvh] overflow-auto">
        <table className={cx(ESTILO_TABLA, className)} {...p}>
          {children}
        </table>
      </div>
      {pie && <div className="border-t border-linea px-4 py-3 text-sm text-tenue">{pie}</div>}
    </div>
  )
}

/** Celda de dinero: alineada a la derecha, cifras tabulares. */
export const celdaMonto = 'cifra text-right font-medium tracking-[-0.01em] whitespace-nowrap'
export const celdaPrincipal = 'font-medium text-tinta'
