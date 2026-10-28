import type { ReactNode, TableHTMLAttributes } from 'react'
import { cx } from './cx'

const ESTILO_TABLA = [
  'w-full border-separate border-spacing-0 text-[14px]',
  '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:border-b [&_thead_th]:border-linea [&_thead_th]:bg-hundido',
  '[&_thead_th]:px-4 [&_thead_th]:py-2.5 [&_thead_th]:text-left [&_thead_th]:text-[11px] [&_thead_th]:font-semibold',
  '[&_thead_th]:uppercase [&_thead_th]:tracking-[0.08em] [&_thead_th]:text-tenue',
  '[&_tbody_td]:h-12 [&_tbody_td]:border-b [&_tbody_td]:border-linea [&_tbody_td]:px-4 [&_tbody_td]:py-2',
  '[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-marca-suave/50',
  '[&_tbody_tr[aria-selected=true]]:bg-marca-suave',
].join(' ')

/**
 * Envoltorio visual de tabla: tarjeta redondeada, header sticky, filas de 48px con hover.
 * Uso: <DataTable aria-label="Trámites"><thead>…</thead><tbody>…</tbody></DataTable>
 */
export function DataTable({ className, children, pie, ...p }: TableHTMLAttributes<HTMLTableElement> & { pie?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg bg-superficie shadow-tarjeta ring-1 ring-linea">
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
export const celdaMonto = 'cifra text-right font-medium whitespace-nowrap'
export const celdaPrincipal = 'font-semibold text-tinta'
