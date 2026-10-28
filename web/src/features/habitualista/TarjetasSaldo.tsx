import type { ReactNode } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { hoyEnBuenosAires } from '../tramites/filtros'
import type { Saldo } from './consultas'
import { conciliacionVencida, fechaOperativa } from './saldos'

function Tarjeta({ titulo, children, alerta = false }: { titulo: string; children: ReactNode; alerta?: boolean }) {
  return (
    <section
      aria-label={titulo}
      className={`border bg-white px-3 py-2 ${alerta ? 'border-amber-400 bg-amber-50' : 'border-linea'}`}
    >
      <h2 className="text-xs font-medium text-tenue">{titulo}</h2>
      {children}
    </section>
  )
}

const Importe = ({ cents, negativo = false }: { cents: string; negativo?: boolean }) => (
  <p data-testid="importe" className={`text-xl font-semibold ${negativo ? 'text-alerta' : ''}`}>
    {formatearPesos(cents)}
  </p>
)

export function TarjetasSaldo({ saldo }: { saldo: Saldo }) {
  const vencida = conciliacionVencida(saldo.ultima_conciliacion_fecha, saldo.ultima_diferencia, hoyEnBuenosAires())
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tarjeta titulo="Saldo registrado">
        <Importe cents={saldo.registrado} negativo={saldo.registrado.startsWith('-')} />
      </Tarjeta>
      <Tarjeta titulo="Comprometido">
        <Importe cents={saldo.comprometido} />
      </Tarjeta>
      <Tarjeta titulo="Disponible proyectado">
        <Importe cents={saldo.disponible} negativo={saldo.disponible.startsWith('-')} />
      </Tarjeta>
      <Tarjeta titulo="Última conciliación" alerta={vencida}>
        {saldo.ultima_conciliacion_fecha ? (
          <p className="text-sm">
            <span className="text-xl font-semibold">{fechaOperativa(saldo.ultima_conciliacion_fecha)}</span>{' '}
            <span data-testid="diferencia">
              diferencia {formatearPesos(saldo.ultima_diferencia ?? '0')}
            </span>
          </p>
        ) : (
          <p className="text-xl font-semibold">Nunca</p>
        )}
        {vencida && <p className="text-xs font-medium text-amber-800">Sin verificar</p>}
      </Tarjeta>
    </div>
  )
}
