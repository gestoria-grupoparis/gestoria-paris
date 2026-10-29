import { NavLink, Outlet, useNavigate } from 'react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, type Rol } from '../lib/sesion'
import { navegacionPorRol } from './navegacion'
import { Button, LogoGrupoParis, cx } from '../ui'

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
  '/usuarios': <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15.5 5.5a3 3 0 0 1 0 6M17.5 14.8c1.5.6 2.5 2 3 4.2" /></>,
  '/mis-tramites': <path d="M9 5h10M9 12h10M9 19h10M4 5h1M4 12h1M4 19h1" />,
}

function Icono({ ruta }: { ruta: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONOS[ruta] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  )
}

function iniciales(nombre?: string) {
  return (nombre ?? '?').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

const EMPRESA = 'Grupo Paris'

function IconoSalir({ className = 'size-5' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
    </svg>
  )
}

function IconoLlave({ className = 'size-5' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2" />
    </svg>
  )
}

export function Layout() {
  const { perfil, rol } = useSesion()
  const items = navegacionPorRol(rol)
  const [cuenta, setCuenta] = useState(false)
  const rolTexto = rol ? ROL_ETIQUETA[rol] : ''
  const salir = () => void supabase.auth.signOut()
  const navegar = useNavigate()
  const cambiarClave = () => { setCuenta(false); navegar('/cambiar-clave') }

  useEffect(() => {
    if (!cuenta) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setCuenta(false)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [cuenta])

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-noche text-white md:flex">
        <div className="px-5 pt-6 pb-8">
          <LogoGrupoParis tono="claro" className="h-8" />
        </div>
        <p className="rotulo-marca px-6 pb-3 text-[9px] text-white/35">Menú</p>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 px-3">
          {items.map((i) => (
            <NavLink
              key={i.ruta}
              to={i.ruta}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium transition-colors',
                  isActive ? 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/[0.06]' : 'text-white/55 hover:bg-white/[0.04] hover:text-white',
                )
              }
            >
              <Icono ruta={i.ruta} />
              {i.etiqueta}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-lg bg-white/[0.04] p-3 ring-1 ring-white/[0.08]">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[13px] font-semibold text-noche">
              {iniciales(perfil?.nombre)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium">{perfil?.nombre}</div>
              <div className="mt-0.5 truncate text-[12px] text-white/50">
                {rolTexto} · {EMPRESA}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium text-white/70 hover:bg-white/[0.05] hover:text-white"
            onClick={cambiarClave}
          >
            <IconoLlave className="size-4" />
            Cambiar contraseña
          </button>
          <button
            type="button"
            className="mt-1.5 flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium text-white/70 ring-1 ring-white/[0.12] hover:bg-white/[0.05] hover:text-white"
            onClick={salir}
          >
            <IconoSalir className="size-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-linea bg-superficie/90 px-4 backdrop-blur-md md:hidden">
          <LogoGrupoParis className="h-8" />
          <button
            type="button"
            aria-label="Tu cuenta"
            aria-expanded={cuenta}
            aria-haspopup="dialog"
            onClick={() => setCuenta(true)}
            className="grid size-11 place-items-center rounded-full"
          >
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-marca text-[13px] font-semibold text-superficie">
              {iniciales(perfil?.nombre)}
            </span>
          </button>
        </header>
        <main className="min-w-0 pb-24 md:pb-0">
          <Outlet />
        </main>
      </div>

      {cuenta && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Cerrar" tabIndex={-1} className="absolute inset-0 bg-noche/50" onClick={() => setCuenta(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tu cuenta"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-superficie px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-flotante"
          >
            <span aria-hidden className="mx-auto mb-5 block h-1 w-10 rounded-full bg-linea-fuerte" />
            <div className="flex items-center gap-4">
              <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-marca text-lg font-semibold text-superficie">
                {iniciales(perfil?.nombre)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight">{perfil?.nombre}</p>
                <p className="text-sm text-tenue">{rolTexto} · {EMPRESA}</p>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2.5">
              <Button variante="secundario" tamano="lg" ancho icono={<IconoLlave />} onClick={cambiarClave}>
                Cambiar contraseña
              </Button>
              <Button variante="secundario" tamano="lg" ancho icono={<IconoSalir />} onClick={salir}>
                Cerrar sesión
              </Button>
              <Button variante="fantasma" tamano="lg" ancho onClick={() => setCuenta(false)} autoFocus>
                Volver
              </Button>
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Principal móvil"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-linea bg-superficie/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map((i) => (
          <NavLink
            key={i.ruta}
            to={i.ruta}
            className={({ isActive }) =>
              cx(
                'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                isActive ? 'text-tinta after:absolute after:top-0 after:h-[2px] after:w-8 after:rounded-b after:bg-marca' : 'text-tenue',
              )
            }
          >
            <Icono ruta={i.ruta} />
            {i.etiqueta}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
