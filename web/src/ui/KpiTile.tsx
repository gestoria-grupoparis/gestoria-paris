import type { ReactNode } from 'react'
import { cx } from './cx'

export type TonoKpi = 'neutro' | 'destacado' | 'disponible' | 'comprometido' | 'sinfondos'

const TONOS: Record<TonoKpi, string> = {
  neutro: 'bg-superficie ring-linea text-tinta',
  destacado: 'bg-marca ring-marca text-superficie',
  disponible: 'bg-superficie ring-linea text-disponible',
  comprometido: 'bg-superficie ring-linea text-comprometido',
  sinfondos: 'bg-sinfondos-suave ring-sinfondos/30 text-sinfondos',
}

/** `valor` llega YA formateado (formatearPesos): el front no calcula montos. */
export function KpiTile({
  rotulo,
  valor,
  detalle,
  tono = 'neutro',
  icono,
  grande,
  className,
}: {
  rotulo: string
  valor: ReactNode
  detalle?: ReactNode
  tono?: TonoKpi
  icono?: ReactNode
  /** Cifra protagonista (p. ej. el disponible). */
  grande?: boolean
  className?: string
}) {
  const oscuro = tono === 'destacado'
  return (
    <div className={cx('flex flex-col gap-2 rounded-lg p-5 shadow-tarjeta ring-1', TONOS[tono], className)}>
      <div className="flex items-center justify-between">
        <span className={cx('text-[11px] font-semibold uppercase tracking-[0.08em]', oscuro ? 'text-laton' : 'text-tenue')}>{rotulo}</span>
        {icono && <span aria-hidden className="opacity-70">{icono}</span>}
      </div>
      <span className={cx('cifra font-display font-bold leading-none tracking-tight whitespace-nowrap', grande ? 'text-[34px] md:text-[48px]' : 'text-[24px] xl:text-[28px]')}>{valor}</span>
      {detalle && <span className={cx('text-[13px]', oscuro ? 'text-superficie/75' : 'text-tenue')}>{detalle}</span>}
    </div>
  )
}
