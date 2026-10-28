import type { ReactNode } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { IconoAlerta, IconoCheck, IconoReloj, KpiTile, cx, type TonoKpi } from '../../ui'
import { hoyEnBuenosAires } from '../tramites/filtros'
import type { Saldo } from './consultas'
import { conciliacionVencida, fechaOperativa } from './saldos'

const negativo = (cents: string) => cents.startsWith('-') && !/^-0+$/.test(cents)

/** Cada tarjeta es una región con nombre (lectores de pantalla y tests la ubican por título). */
function Tarjeta({ titulo, className, ...p }: { titulo: string; valor: ReactNode; detalle?: ReactNode; tono?: TonoKpi; icono?: ReactNode; grande?: boolean; className?: string }) {
  return (
    <section aria-label={titulo} className={className}>
      <KpiTile rotulo={titulo} className="h-full justify-between" {...p} />
    </section>
  )
}

const Importe = ({ cents }: { cents: string }) => <span data-testid="importe">{formatearPesos(cents)}</span>

export function TarjetasSaldo({ saldo }: { saldo: Saldo }) {
  const vencida = conciliacionVencida(saldo.ultima_conciliacion_fecha, saldo.ultima_diferencia, hoyEnBuenosAires())
  const sinFondos = negativo(saldo.disponible)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Tarjeta
        titulo="Disponible proyectado"
        className="sm:col-span-2"
        grande
        tono={sinFondos ? 'sinfondos' : 'destacado'}
        valor={<Importe cents={saldo.disponible} />}
        detalle={sinFondos ? 'No alcanza para lo comprometido: hace falta una carga.' : 'Lo que queda libre después de pagar lo comprometido.'}
      />
      <Tarjeta
        titulo="Saldo registrado"
        tono={negativo(saldo.registrado) ? 'sinfondos' : 'neutro'}
        valor={<Importe cents={saldo.registrado} />}
        detalle="Cargas menos pagos registrados"
      />
      <Tarjeta
        titulo="Comprometido"
        tono="comprometido"
        valor={<Importe cents={saldo.comprometido} />}
        detalle="Presupuestos todavía sin pagar"
      />
      <Tarjeta
        titulo="Última conciliación"
        className="sm:col-span-2 lg:col-span-1"
        icono={vencida ? <IconoAlerta className="text-comprometido" /> : <IconoCheck className="text-disponible" />}
        valor={saldo.ultima_conciliacion_fecha ? fechaOperativa(saldo.ultima_conciliacion_fecha) : 'Nunca'}
        detalle={
          <span className="flex flex-col gap-1.5">
            {saldo.ultima_conciliacion_fecha && (
              <span data-testid="diferencia">diferencia {formatearPesos(saldo.ultima_diferencia ?? '0')}</span>
            )}
            <span
              className={cx(
                'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold',
                vencida ? 'bg-comprometido-suave text-comprometido' : 'bg-disponible-suave text-disponible',
              )}
            >
              {vencida ? <IconoReloj className="size-3.5" /> : <IconoCheck className="size-3.5" />}
              {vencida ? 'Sin verificar' : 'Verificada'}
            </span>
          </span>
        }
      />
    </div>
  )
}
