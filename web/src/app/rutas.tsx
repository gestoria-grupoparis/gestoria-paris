import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useSesion } from '../lib/sesion'
import { Login } from '../pages/Login'
import { Layout } from './Layout'
import { navegacionPorRol } from './navegacion'
import { pantallaPara } from '../lib/perfil'
const Tramites = lazy(() => import('../pages/Tramites').then((m) => ({ default: m.Tramites })))
const MisTramites = lazy(() => import('../pages/MisTramites').then((m) => ({ default: m.MisTramites })))
const Habitualista = lazy(() => import('../pages/Habitualista').then((m) => ({ default: m.Habitualista })))
const Tablero = lazy(() => import('../pages/Tablero').then((m) => ({ default: m.Tablero })))
const Usuarios = lazy(() => import('../pages/Usuarios').then((m) => ({ default: m.Usuarios })))
const Rendiciones = lazy(() => import('../pages/Rendiciones').then((m) => ({ default: m.Rendiciones })))
const Analisis = lazy(() => import('../pages/Analisis').then((m) => ({ default: m.Analisis })))
const Informes = lazy(() => import('../pages/Informes').then((m) => ({ default: m.Informes })))
import { Button, PaginaPendiente, PantallaCarga, PantallaMensaje } from '../ui'
import { DefinirClave } from '../features/acceso/DefinirClave'
import { errorEnUrl } from '../lib/clave'

/**
 * Error que Supabase Auth dejó en la URL del link de invitación/recuperación. Se lee al cargar el
 * módulo, antes de que supabase-js procese y limpie la URL.
 */
const ERROR_LINK = typeof window === 'undefined' ? null : errorEnUrl(window.location.hash || window.location.search)

const icoLink = (
  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16" />
  </svg>
)

/** /definir-clave sin sesión: el link venció, ya se usó o se abrió en otro navegador. */
function LinkInvalido() {
  const navegar = useNavigate()
  return (
    <PantallaMensaje
      tono="error"
      icono={icoLink}
      titulo={ERROR_LINK === 'vencido' ? 'El link venció' : 'El link no es válido'}
      descripcion="Los links para definir la contraseña duran una hora y sirven una sola vez. Pedí uno nuevo con tu email y abrilo desde este mismo navegador."
      acciones={
        <>
          <Button ancho onClick={() => navegar('/', { replace: true, state: { recuperar: true } })}>Pedir un link nuevo</Button>
          <Button ancho variante="secundario" onClick={() => navegar('/', { replace: true })}>Ir al ingreso</Button>
        </>
      }
    />
  )
}

const PANTALLAS: Record<string, ComponentType> = {
  '/tramites': Tramites,
  '/mis-tramites': MisTramites,
  '/habitualista': Habitualista,
  '/tablero': Tablero,
  '/usuarios': Usuarios,
  '/informes': Informes,
  '/rendiciones': Rendiciones,
  '/analisis': Analisis,
}

function Pendiente({ titulo }: { titulo: string }) {
  return <PaginaPendiente titulo={titulo} />
}

function elementoDe(ruta: string, etiqueta: string) {
  const Pantalla = PANTALLAS[ruta]
  return Pantalla ? (
    <Suspense fallback={<div role="status" className="p-8 text-sm text-tenue">Cargando…</div>}>
      <Pantalla />
    </Suspense>
  ) : (
    <Pendiente titulo={etiqueta} />
  )
}

export function Rutas() {
  const sesion = useSesion()
  const { rol } = sesion
  const pantalla = pantallaPara(sesion)
  const { pathname, state } = useLocation()
  const navegar = useNavigate()
  if (pantalla === 'cargando') return <PantallaCarga />
  if (pathname === '/definir-clave') {
    if (!sesion.conSesion) return <LinkInvalido />
    if (pantalla === 'app' || pantalla === 'error_perfil')
      return <DefinirClave modo="definir" alTerminar={() => navegar('/', { replace: true })} />
  }
  // Alta con contraseña inicial: antes de usar la app elige la suya.
  if (pantalla === 'app' && sesion.perfil?.debe_cambiar_clave)
    return <DefinirClave modo="definir" alTerminar={() => { sesion.reintentar(); navegar('/', { replace: true }) }} />
  if (pantalla === 'login') return <Login modoInicial={(state as { recuperar?: boolean } | null)?.recuperar ? 'recuperar' : 'ingresar'} />
  if (pantalla === 'login_inactivo')
    return <Login aviso="Usuario inactivo. Pedile a gerencia que lo reactive." />
  if (pantalla === 'error_perfil')
    return (
      <PantallaMensaje
        tono="error"
        titulo="No se pudo cargar tu perfil"
        descripcion="Puede ser la conexión o un problema momentáneo. Volvé a intentar; si sigue pasando, avisale a gerencia."
        icono={<svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>}
        acciones={
          <>
            <Button ancho onClick={sesion.reintentar}>Reintentar</Button>
            <Button ancho variante="secundario" onClick={sesion.salir}>Salir</Button>
          </>
        }
      />
    )
  const items = navegacionPorRol(rol)
  const inicio = items[0]?.ruta
  return (
    <Routes>
      <Route path="/cambiar-clave" element={<DefinirClave modo="cambiar" alTerminar={() => navegar(-1)} />} />
      <Route element={<Layout />}>
        {items.map((i) => (
          <Route key={i.ruta} path={i.ruta} element={elementoDe(i.ruta, i.etiqueta)} />
        ))}
        <Route
          path="*"
          element={
            inicio ? <Navigate to={inicio} replace /> : <PaginaPendiente titulo="Todavía no tenés secciones asignadas" descripcion="Tu rol aún no tiene pantallas habilitadas. Pedile a gerencia que revise tus permisos." />
          }
        />
      </Route>
    </Routes>
  )
}
