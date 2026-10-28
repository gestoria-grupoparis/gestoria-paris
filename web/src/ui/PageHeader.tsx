import type { ReactNode } from 'react'

export function PageHeader({ titulo, rotulo, descripcion, acciones }: { titulo: string; rotulo?: ReactNode; descripcion?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {rotulo && <div className="rotulo mb-2">{rotulo}</div>}
        <h1 className="text-[28px] font-extrabold leading-tight md:text-[34px]">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-2xl text-[15px] text-tenue">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </header>
  )
}
