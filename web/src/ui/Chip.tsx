import type { ReactNode } from 'react'
import { cx } from './cx'

export type TonoChip = 'neutro' | 'marca' | 'info' | 'disponible' | 'comprometido' | 'sinfondos' | 'apagado' | 'solido'

const TONOS: Record<TonoChip, string> = {
  neutro: 'bg-hundido text-tenue',
  marca: 'bg-marca-suave text-marca-tinta ring-1 ring-inset ring-linea-fuerte/60',
  info: 'bg-info-suave text-info',
  disponible: 'bg-disponible-suave text-disponible',
  comprometido: 'bg-comprometido-suave text-comprometido',
  sinfondos: 'bg-sinfondos-suave text-sinfondos',
  apagado: 'bg-hundido text-tenue line-through decoration-tenue/50',
  solido: 'bg-marca text-superficie',
}

/** Tono por estado de trámite (los 11 estados). */
export const TONO_ESTADO: Record<string, TonoChip> = {
  borrador: 'neutro',
  observado: 'comprometido',
  autorizado: 'info',
  en_gestoria: 'marca',
  presentado: 'marca',
  finalizado_registro: 'disponible',
  devuelto: 'disponible',
  cerrado: 'solido',
  suspendido: 'comprometido',
  cancelado: 'apagado',
  rechazado: 'sinfondos',
}

export function Chip({ tono = 'neutro', punto = true, children, className }: { tono?: TonoChip; punto?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium', TONOS[tono], className)}>
      {punto && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function ChipEstado({ estado, etiqueta }: { estado: string; etiqueta: string }) {
  return <Chip tono={TONO_ESTADO[estado] ?? 'neutro'}>{etiqueta}</Chip>
}
