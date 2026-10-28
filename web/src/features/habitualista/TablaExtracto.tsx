import { formatearPesos } from '../../lib/dinero'
import { TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

function vinculo(m: Movimiento): string {
  if (m.revertidoPor) return `Revertido el ${fechaOperativa(m.revertidoPor.fecha_operacion)}`
  if (m.revierte)
    return `Revierte ${m.revierte.tipo === 'pago_tramite' ? 'el pago' : `la ${(TIPOS_MOVIMIENTO[m.revierte.tipo] ?? m.revierte.tipo).toLowerCase()}`} del ${fechaOperativa(m.revierte.fecha_operacion)}`
  return ''
}

const TH = 'border-b border-linea px-2 py-1.5 text-left text-xs font-medium text-tenue whitespace-nowrap'
const TD = 'border-b border-linea px-2 py-1 whitespace-nowrap'

export function TablaExtracto({ filas, onRevertir }: { filas: Movimiento[]; onRevertir: (m: Movimiento) => void }) {
  if (!filas.length) return <p className="p-4 text-sm text-tenue">Todavía no hay movimientos. Registrá la primera carga.</p>
  return (
    <div className="overflow-x-auto border border-linea bg-white">
      <table aria-label="Movimientos" className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>Fecha</th>
            <th className={TH}>Tipo</th>
            <th className={TH}>Trámite</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Responsable</th>
            <th className={`${TH} text-right`}>Ingreso</th>
            <th className={`${TH} text-right`}>Egreso</th>
            <th className={`${TH} text-right`}>Saldo resultante</th>
            <th className={TH}>Conciliado</th>
            <th className={TH}>Vínculo</th>
            <th className={TH}><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr key={m.movimiento_id} className={m.revertidoPor ? 'text-tenue' : ''}>
              <td className={TD}>{fechaOperativa(m.fecha_operacion)}</td>
              <td className={TD}>{TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo}</td>
              <td className={TD}>{m.tramite_numero ?? '—'}</td>
              <td className={TD}>{m.cliente ?? '—'}</td>
              <td className={TD}>{m.responsable}</td>
              <td data-testid="ingreso" className={`${TD} text-right text-emerald-700`}>
                {m.ingreso !== '0' ? formatearPesos(m.ingreso) : ''}
              </td>
              <td data-testid="egreso" className={`${TD} text-right`}>
                {m.egreso !== '0' ? formatearPesos(m.egreso) : ''}
              </td>
              <td data-testid="saldo" className={`${TD} text-right font-medium`}>{formatearPesos(m.saldo)}</td>
              <td data-testid="conciliado" className={`${TD} ${m.conciliado ? 'text-emerald-700' : 'text-amber-800'}`}>
                {m.conciliado ? '✓' : 'Pendiente'}
              </td>
              <td data-testid="vinculo" className={`${TD} text-xs`}>{vinculo(m)}</td>
              <td className={TD}>
                {m.tipo !== 'reversion' && !m.revertidoPor && (
                  <button type="button" onClick={() => onRevertir(m)} className="text-xs font-medium text-marca underline">
                    Revertir
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
