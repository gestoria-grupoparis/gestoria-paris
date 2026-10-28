import { Navigate, Route, Routes } from 'react-router'
import { useSesion } from '../lib/sesion'
import { Login } from '../pages/Login'
import { Layout } from './Layout'
import { navegacionPorRol } from './navegacion'

// Las pantallas reales llegan en las tareas siguientes.
function Pendiente({ titulo }: { titulo: string }) {
  return <h1 className="px-4 py-4 text-lg font-semibold">{titulo}</h1>
}

export function Rutas() {
  const { perfil, rol, cargando } = useSesion()
  if (cargando) return <p className="p-4 text-sm text-tenue">Cargando…</p>
  if (!perfil) return <Login />
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
