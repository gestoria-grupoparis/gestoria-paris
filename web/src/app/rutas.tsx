import { Navigate, Route, Routes } from 'react-router'
import { useSesion } from '../lib/sesion'
import { Login } from '../pages/Login'
import { Layout } from './Layout'
import { navegacionPorRol } from './navegacion'
import { pantallaPara } from '../lib/perfil'

// Las pantallas reales llegan en las tareas siguientes.
function Pendiente({ titulo }: { titulo: string }) {
  return <h1 className="px-4 py-4 text-lg font-semibold">{titulo}</h1>
}

export function Rutas() {
  const sesion = useSesion()
  const { rol } = sesion
  const pantalla = pantallaPara(sesion)
  if (pantalla === 'cargando') return <p className="p-4 text-sm text-tenue">Cargando…</p>
  if (pantalla === 'login') return <Login />
  if (pantalla === 'login_inactivo')
    return <Login aviso="Usuario inactivo. Pedile a gerencia que lo reactive." />
  if (pantalla === 'error_perfil')
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div role="alert" className="w-full max-w-sm border border-linea bg-white p-6">
          <h1 className="text-lg font-semibold">No se pudo cargar tu perfil</h1>
          <p className="mb-4 text-sm text-tenue">Revisá tu conexión y volvé a intentar.</p>
          <div className="flex gap-2">
            <button type="button" onClick={sesion.reintentar} className="flex-1 bg-marca py-2 font-medium text-white">
              Reintentar
            </button>
            <button type="button" onClick={sesion.salir} className="flex-1 border border-linea py-2 font-medium">
              Salir
            </button>
          </div>
        </div>
      </div>
    )
  const items = navegacionPorRol(rol)
  const inicio = items[0]?.ruta
  return (
    <Routes>
      <Route element={<Layout />}>
        {items.map((i) => (
          <Route key={i.ruta} path={i.ruta} element={<Pendiente titulo={i.etiqueta} />} />
        ))}
        <Route
          path="*"
          element={
            inicio ? <Navigate to={inicio} replace /> : <Pendiente titulo="Tu rol todavía no tiene pantallas asignadas." />
          }
        />
      </Route>
    </Routes>
  )
}
