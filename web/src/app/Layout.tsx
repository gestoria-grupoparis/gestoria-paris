import { NavLink, Outlet } from 'react-router'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, type Rol } from '../lib/sesion'
import { navegacionPorRol } from './navegacion'
import { Wordmark, cx } from '../ui'

const ROL_ETIQUETA: Record<Rol, string> = {
  gerencia: 'Gerencia',
  contable: 'Contable',
  gestora: 'Gestora',
  comercial: 'Comercial',
  admin: 'Administración',
}

const ICONOS: Record<string, ReactNode> = {
  '/tablero': <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />,
  '/tramites': <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  '/habitualista': <path d="M3 7h18v12H3zM3 11h18M7 15h3" />,
  '/mis-tramites': <path d="M9 5h10M9 12h10M9 19h10M4 5h1M4 12h1M4 19h1" />,
}

function Icono({ ruta }: { ruta: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONOS[ruta] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  )
}

function iniciales(nombre?: string) {
  return (nombre ?? '?').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

export function Layout() {
  const { perfil, rol } = useSesion()
  const items = navegacionPorRol(rol)
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-noche text-superficie md:flex">
        <div className="px-5 pt-6 pb-8">
          <Wordmark tono="claro" />
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 px-3">
          {items.map((i) => (
            <NavLink
              key={i.ruta}
              to={i.ruta}
              className={({ isActive }) =>
                cx(
                  'flex h-11 items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors',
                  isActive ? 'bg-superficie/10 text-superficie shadow-[inset_3px_0_0_var(--color-laton)]' : 'text-superficie/65 hover:bg-superficie/5 hover:text-superficie',
                )
              }
            >
              <Icono ruta={i.ruta} />
              {i.etiqueta}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 flex items-center gap-3 rounded-lg bg-superficie/5 p-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-laton font-display text-sm font-bold text-noche">
            {iniciales(perfil?.nombre)}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="truncate font-semibold">{perfil?.nombre}</div>
            <div className="text-[12px] text-superficie/55">{rol ? ROL_ETIQUETA[rol] : ''}</div>
          </div>
          <button
            className="rounded px-1.5 py-1 text-[12px] font-semibold text-superficie/70 hover:text-superficie"
            onClick={() => supabase.auth.signOut()}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-linea bg-superficie px-4 md:hidden">
          <Wordmark />
          <span aria-hidden className="grid size-9 place-items-center rounded-full bg-marca font-display text-sm font-bold text-superficie">
            {iniciales(perfil?.nombre)}
          </span>
        </header>
        <main className="min-w-0 pb-24 md:pb-0">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Principal móvil"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-linea bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map((i) => (
          <NavLink
            key={i.ruta}
            to={i.ruta}
            className={({ isActive }) =>
              cx('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold', isActive ? 'text-marca' : 'text-tenue')
            }
          >
            <Icono ruta={i.ruta} />
            {i.etiqueta}
          </NavLink>
        ))}
        <button className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-4 text-[12px] font-semibold text-tenue" onClick={() => supabase.auth.signOut()}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
          </svg>
          Salir
        </button>
      </nav>
    </div>
  )
}
