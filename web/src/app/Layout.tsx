import { NavLink, Outlet } from 'react-router'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { navegacionPorRol } from './navegacion'

const claseLink = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-marca ${
    isActive ? 'bg-marca text-white' : 'text-tinta hover:bg-linea/60'
  }`

export function Layout() {
  const { perfil, rol } = useSesion()
  const items = navegacionPorRol(rol)
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-linea bg-white md:flex">
        <div className="border-b border-linea px-3 py-3 text-sm font-semibold">Gestoría Paris</div>
        <nav aria-label="Principal" className="flex-1 py-2">
          {items.map((i) => (
            <NavLink key={i.ruta} to={i.ruta} className={claseLink}>
              {i.etiqueta}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-linea px-3 py-3 text-xs text-tenue">
          <div className="text-tinta">{perfil?.nombre}</div>
          <button className="mt-1 underline" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>
      <nav
        aria-label="Principal móvil"
        className="fixed inset-x-0 bottom-0 flex border-t border-linea bg-white md:hidden"
      >
        {items.map((i) => (
          <NavLink key={i.ruta} to={i.ruta} className={(s) => `flex-1 text-center ${claseLink(s)}`}>
            {i.etiqueta}
          </NavLink>
        ))}
        <button className="px-3 text-sm text-tenue" onClick={() => supabase.auth.signOut()}>
          Salir
        </button>
      </nav>
    </div>
  )
}
