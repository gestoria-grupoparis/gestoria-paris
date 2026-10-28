import type { ReactNode } from 'react'
import { Placa, Wordmark } from './Marca'
import { cx } from './cx'

/** Pantalla completa mientras se resuelve la sesión. */
export function PantallaCarga({ etiqueta = 'Cargando tu sesión…' }: { etiqueta?: string }) {
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-noche px-4 text-superficie">
      <div className="flex flex-col items-center gap-5">
        <Placa className="scale-150" />
        <span className="mt-2 h-1 w-28 overflow-hidden rounded-full bg-superficie/10">
          <span className="esqueleto block h-full w-full opacity-40" />
        </span>
        <p className="text-[13px] text-superficie/60">{etiqueta}</p>
      </div>
    </div>
  )
}

/** Mensaje de pantalla completa (error de perfil, sin acceso). */
export function PantallaMensaje({ titulo, descripcion, acciones, tono = 'neutro', icono }: {
  titulo: string
  descripcion?: ReactNode
  acciones?: ReactNode
  tono?: 'neutro' | 'error'
  icono?: ReactNode
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-noche px-4 py-10">
      <div role={tono === 'error' ? 'alert' : undefined} className="w-full max-w-[420px] rounded-2xl bg-superficie p-8 text-tinta shadow-flotante">
        <Wordmark className="mb-8" />
        {icono && (
          <span aria-hidden className={cx('mb-4 grid size-12 place-items-center rounded-full', tono === 'error' ? 'bg-sinfondos-suave text-sinfondos' : 'bg-marca-suave text-marca')}>
            {icono}
          </span>
        )}
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-2 text-[15px] leading-relaxed text-tenue">{descripcion}</p>}
        {acciones && <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">{acciones}</div>}
      </div>
    </div>
  )
}

/** Sección todavía no construida, dentro del shell. */
export function PaginaPendiente({ titulo, descripcion, accion }: { titulo: string; descripcion?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-10 md:py-14">
      <p className="rotulo mb-2">Próximamente</p>
      <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-tight md:text-[40px]">{titulo}</h1>
      <div className="mt-8 rounded-2xl border border-dashed border-linea-fuerte bg-superficie/70 p-8 md:p-10">
        <span aria-hidden className="mb-4 grid size-12 place-items-center rounded-full bg-comprometido-suave text-comprometido">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5" />
          </svg>
        </span>
        <p className="text-lg font-semibold">Esta sección está en construcción.</p>
        <p className="mt-1 max-w-lg text-[15px] leading-relaxed text-tenue">
          {descripcion ?? 'Ya está prevista en el plan y llega en una próxima entrega. Mientras tanto, seguí desde el menú.'}
        </p>
        {accion && <div className="mt-6">{accion}</div>}
      </div>
    </div>
  )
}
