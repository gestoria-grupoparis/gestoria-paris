import type { ReactNode } from 'react'
import { LogoGrupoParis, Monograma } from '../../ui'

/** Marco oscuro de las pantallas de acceso (definir / cambiar contraseña, links de email). */
export function MarcoAcceso({ children }: { children: ReactNode }) {
  return (
    <div className="tema-oscuro relative isolate flex min-h-dvh flex-col overflow-hidden bg-noche text-tinta">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgb(255_255_255/0.09),transparent_65%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-[22vh] top-1/2 -z-10 -translate-y-1/2 [mask-image:radial-gradient(closest-side,#000_55%,transparent)]">
        <Monograma titulo="" className="size-[92vh] max-w-none text-white/[0.035]" />
      </div>
      <header className="flex items-center justify-between px-5 pt-6 md:px-10 md:pt-8">
        <LogoGrupoParis tono="claro" className="h-10 md:h-12" />
        <span className="rotulo-marca hidden text-white/60 sm:inline">Gestoría interna</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      <footer className="pb-8 text-center text-[12px] text-white/60 md:pb-10">
        Uso interno · acceso solo con usuario asignado por gerencia
      </footer>
    </div>
  )
}

export function AlertaAcceso({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <div role="alert" className="mt-5 flex gap-3 rounded-md bg-sinfondos-suave px-4 py-3 text-sinfondos ring-1 ring-sinfondos/25">
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
      </svg>
      <div className="text-sm leading-snug">
        <p className="font-semibold">{titulo}</p>
        {detalle && <p className="mt-0.5 text-tinta/75">{detalle}</p>}
      </div>
    </div>
  )
}

export function BotonVer({ ver, onClick }: { ver: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ver}
      aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      className="-my-3 min-h-11 min-w-11 rounded px-2 py-3 text-[13px] font-medium text-tenue hover:text-tinta">
      {ver ? 'Ocultar' : 'Mostrar'}
    </button>
  )
}
