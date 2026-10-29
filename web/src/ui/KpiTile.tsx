import type { ReactNode } from 'react'
import { cx } from './cx'

export type TonoKpi = 'neutro' | 'destacado' | 'disponible' | 'comprometido' | 'sinfondos'

const TONOS: Record<TonoKpi, string> = {
  neutro: 'bg-superficie ring-linea text-tinta',
  destacado: 'bg-marca ring-marca text-superficie',
  disponible: 'bg-superficie ring-linea text-disponible',
  comprometido: 'bg-superficie ring-linea text-comprometido',
  sinfondos: 'bg-superficie ring-sinfondos/35 text-sinfondos',
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
    <div className={cx('@container flex min-w-0 flex-col gap-3 rounded-lg p-5 ring-1', TONOS[tono], className)}>
      <div className="flex items-center justify-between">
        <span className={cx('text-[12px] font-medium', oscuro ? 'text-white/60' : 'text-tenue')}>{rotulo}</span>
        {icono && <span aria-hidden className="opacity-70">{icono}</span>}
      </div>
      <span className={cx('cifra font-display font-medium leading-none tracking-[-0.03em] whitespace-nowrap', // la cifra se achica con el ancho de la tarjeta para no cortarse (montos de 8+ dígitos)
        grande ? 'text-[clamp(26px,10cqi,44px)]' : 'text-[clamp(14px,9.5cqi,26px)]')}>{valor}</span>
      {detalle && <span className={cx('text-[13px]', oscuro ? 'text-white/60' : 'text-tenue')}>{detalle}</span>}
    </div>
  )
}
