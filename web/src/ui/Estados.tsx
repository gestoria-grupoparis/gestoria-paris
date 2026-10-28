import type { ReactNode } from 'react'
import { cx } from './cx'

export function EmptyState({ titulo, descripcion, accion, icono }: { titulo: string; descripcion?: ReactNode; accion?: ReactNode; icono?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-linea-fuerte bg-superficie px-6 py-12 text-center">
      <span aria-hidden className="grid size-11 place-items-center rounded-lg bg-hundido text-tenue ring-1 ring-linea">
        {icono ?? <IconoVacio />}
      </span>
      <h3 className="text-[14px] font-semibold">{titulo}</h3>
      {descripcion && <p className="max-w-sm text-sm text-tenue">{descripcion}</p>}
      {accion}
    </div>
  )
}

export function ErrorState({ titulo = 'Algo no salió bien', descripcion, accion }: { titulo?: string; descripcion?: ReactNode; accion?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-sinfondos-suave px-5 py-4 text-sinfondos ring-1 ring-sinfondos/25">
      <strong className="font-semibold">{titulo}</strong>
      {descripcion && <p className="text-sm text-tinta/80">{descripcion}</p>}
      {accion}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('esqueleto block h-4', className)} />
}

export function Cargando({ filas = 5, etiqueta = 'Cargando…' }: { filas?: number; etiqueta?: string }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">{etiqueta}</span>
      {Array.from({ length: filas }, (_, i) => (
        <Skeleton key={i} className={cx('h-11', i % 2 ? 'w-11/12' : 'w-full')} />
      ))}
    </div>
  )
}

function IconoVacio() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 7l2-3h12l2 3M9 12h6" />
    </svg>
  )
}
