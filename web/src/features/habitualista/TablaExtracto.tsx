import { formatearPesos } from '../../lib/dinero'
import type { ReactNode } from 'react'
import { Button, Chip, DataTable, EmptyState, IconoDoc, celdaMonto, celdaPrincipal, cx, type TonoChip } from '../../ui'
import { TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

function vinculo(m: Movimiento): string {
  if (m.revertidoPor) return `Revertido el ${fechaOperativa(m.revertidoPor.fecha_operacion)}`
  if (m.revierte)
    return `Revierte ${m.revierte.tipo === 'pago_tramite' ? 'el pago' : `la ${(TIPOS_MOVIMIENTO[m.revierte.tipo] ?? m.revierte.tipo).toLowerCase()}`} del ${fechaOperativa(m.revierte.fecha_operacion)}`
  return ''
}

const TONO_TIPO: Record<string, TonoChip> = {
  carga: 'disponible',
  pago_tramite: 'marca',
  ajuste: 'info',
  reintegro: 'disponible',
  reversion: 'comprometido',
}

export function TablaExtracto({
  filas,
  onRevertir,
  pie,
}: {
  filas: Movimiento[]
  onRevertir: (m: Movimiento) => void
  pie?: ReactNode
}) {
  if (!filas.length)
    return (
      <EmptyState
        icono={<IconoDoc className="size-6" />}
        titulo="Todavía no hay movimientos"
        descripcion="Registrá la primera carga de fondos y el extracto empieza a armarse acá, con el saldo después de cada movimiento."
      />
    )
  return (
    <>
      {/* Teléfono: una tarjeta por movimiento, sin scroll lateral. */}
      <ul aria-label="Movimientos del extracto" className="flex flex-col gap-2 md:hidden">
        {filas.map((m) => {
          const anulado = !!m.revertidoPor
          return (
            <li key={m.movimiento_id} className={cx('rounded-lg bg-superficie p-4 shadow-tarjeta ring-1 ring-linea', anulado && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col items-start gap-1">
                  <Chip tono={anulado ? 'apagado' : (TONO_TIPO[m.tipo] ?? 'neutro')}>{TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo}</Chip>
                  <span className="text-[13px] text-tenue">
                    {fechaOperativa(m.fecha_operacion)} · {m.responsable}
                  </span>
                </div>
                <span className={cx('cifra font-display text-lg font-bold', m.ingreso !== '0' && !anulado && 'text-disponible')}>
                  {m.ingreso !== '0' ? formatearPesos(m.ingreso) : formatearPesos(m.egreso)}
                </span>
              </div>
              {m.tramite_numero && <div className="mt-2 text-sm"><span className="cifra font-semibold">{m.tramite_numero}</span> · {m.cliente}</div>}
              {vinculo(m) && <div className="mt-1 text-[12px] text-tenue">{vinculo(m)}</div>}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-linea pt-3 text-sm">
                <span className="text-tenue">Saldo <strong className="cifra whitespace-nowrap text-tinta">{formatearPesos(m.saldo)}</strong></span>
                <span className="flex items-center gap-2">
                  {m.conciliado ? <Chip tono="disponible">Conciliado</Chip> : <Chip tono="comprometido">Pendiente</Chip>}
                  {m.tipo !== 'reversion' && !anulado && (
                    <Button variante="fantasma" tamano="sm" onClick={() => onRevertir(m)}>Revertir</Button>
                  )}
                </span>
              </div>
            </li>
          )
        })}
        {pie && <li className="rounded-lg bg-superficie p-4 text-sm text-tenue ring-1 ring-linea">{pie}</li>}
      </ul>
      <div className="hidden md:block">
      <DataTable aria-label="Movimientos" pie={pie}>
        <thead>
          <tr>
            <th>Fecha · quién</th>
            <th>Movimiento</th>
            <th>Trámite · cliente</th>
            <th className="!text-right">Ingreso</th>
            <th className="!text-right">Egreso</th>
            <th className="!text-right">Saldo</th>
            <th>Conciliado</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => {
            const anulado = !!m.revertidoPor
            return (
              <tr key={m.movimiento_id} className={cx(anulado && 'text-tenue')}>
                <td className="whitespace-nowrap leading-tight">
                  <div className="cifra font-medium">{fechaOperativa(m.fecha_operacion)}</div>
                  <div className="text-[12px] text-tenue">{m.responsable}</div>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <Chip tono={anulado ? 'apagado' : (TONO_TIPO[m.tipo] ?? 'neutro')}>{TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo}</Chip>
                    <span data-testid="vinculo" className="text-[12px] text-tenue empty:hidden">{vinculo(m)}</span>
                  </div>
                </td>
                <td className="min-w-40">
                  {m.tramite_numero ? (
                    <div className="leading-tight">
                      <div className={cx(celdaPrincipal, 'cifra')}>{m.tramite_numero}</div>
                      <div className="text-[13px] text-tenue">{m.cliente}</div>
                    </div>
                  ) : (
                    <span className="text-tenue">—</span>
                  )}
                </td>
                <td data-testid="ingreso" className={cx(celdaMonto, !anulado && 'text-disponible')}>
                  {m.ingreso !== '0' ? formatearPesos(m.ingreso) : ''}
                </td>
                <td data-testid="egreso" className={celdaMonto}>
                  {m.egreso !== '0' ? formatearPesos(m.egreso) : ''}
                </td>
                <td data-testid="saldo" className={cx(celdaMonto, 'font-semibold', m.saldo.startsWith('-') && 'text-sinfondos')}>
                  {formatearPesos(m.saldo)}
                </td>
                <td>
                  {m.conciliado ? (
                    <span data-testid="conciliado" title="Conciliado" className="inline-grid size-7 place-items-center rounded-full bg-disponible-suave font-bold text-disponible">✓</span>
                  ) : (
                    <span data-testid="conciliado" className="inline-flex h-6 items-center rounded-full bg-comprometido-suave px-2.5 text-[12px] font-semibold text-comprometido">Pendiente</span>
                  )}
                </td>
                <td className="text-right">
                  {m.tipo !== 'reversion' && !anulado && (
                    <Button variante="fantasma" tamano="sm" onClick={() => onRevertir(m)}>Revertir</Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
      </div>
    </>
  )
}
