import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export function Card({ className, plana, ...p }: HTMLAttributes<HTMLDivElement> & { plana?: boolean }) {
  return <div className={cx('rounded-lg bg-superficie ring-1 ring-linea', className)} {...p} />
}

export function CardHeader({ titulo, rotulo, acciones }: { titulo: ReactNode; rotulo?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-linea px-5 py-4">
      <div>
        {rotulo && <div className="rotulo mb-1">{rotulo}</div>}
        <h2 className="text-[14px] font-semibold">{titulo}</h2>
      </div>
      {acciones && <div className="flex shrink-0 gap-2">{acciones}</div>}
    </div>
  )
}
