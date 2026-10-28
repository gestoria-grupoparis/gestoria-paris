import type { Perfil, Rol } from './sesion'

export type ErrorSesion = 'perfil_no_cargado' | 'inactivo' | null

export interface ResultadoPerfil {
  perfil: Perfil | null
  rol: Rol | null
  error: ErrorSesion
}

/** Interpreta la respuesta del select a perfiles sin tragarse errores. */
export function resolverPerfil(r: { data: unknown; error: unknown }): ResultadoPerfil {
  if (r.error) return { perfil: null, rol: null, error: 'perfil_no_cargado' }
  const data = r.data as Perfil | null
  if (!data) return { perfil: null, rol: null, error: 'perfil_no_cargado' }
  if (!data.activo) return { perfil: null, rol: null, error: 'inactivo' }
  return { perfil: data, rol: data.rol, error: null }
}

export type Pantalla = 'cargando' | 'login' | 'login_inactivo' | 'error_perfil' | 'app'

/** Qué pantalla corresponde al estado de la sesión. Nunca muestra Login a quien tiene sesión. */
export function pantallaPara(e: {
  cargando: boolean
  conSesion: boolean
  perfil: Perfil | null
  error: ErrorSesion
}): Pantalla {
  if (e.cargando) return 'cargando'
  if (e.error === 'inactivo') return 'login_inactivo'
  if (!e.conSesion) return 'login'
  if (e.perfil) return 'app'
  return 'error_perfil'
}
