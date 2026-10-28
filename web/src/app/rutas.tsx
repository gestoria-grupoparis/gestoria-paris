import type { ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { useSesion } from '../lib/sesion'
import { Login } from '../pages/Login'
import { Layout } from './Layout'
import { navegacionPorRol } from './navegacion'
import { pantallaPara } from '../lib/perfil'
import { Tramites } from '../pages/Tramites'
import { MisTramites } from '../pages/MisTramites'
import { Habitualista } from '../pages/Habitualista'
import { Tablero } from '../pages/Tablero'
import { Usuarios } from '../pages/Usuarios'
import { Button, PaginaPendiente, PantallaCarga, PantallaMensaje } from '../ui'

const PANTALLAS: Record<string, ComponentType> = {
  '/tramites': Tramites,
  '/mis-tramites': MisTramites,
  '/habitualista': Habitualista,
  '/tablero': Tablero,
  '/usuarios': Usuarios,
}

function Pendiente({ titulo }: { titulo: string }) {
  return <PaginaPendiente titulo={titulo} />
}

function elementoDe(ruta: string, etiqueta: string) {
  const Pantalla = PANTALLAS[ruta]
  return Pantalla ? <Pantalla /> : <Pendiente titulo={etiqueta} />
}

export function Rutas() {
  const sesion = useSesion()
  const { rol } = sesion
  const pantalla = pantallaPara(sesion)
  if (pantalla === 'cargando') return <PantallaCarga />
  if (pantalla === 'login') return <Login />
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
