import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { resolverPerfil, type ErrorSesion } from './perfil'

export type Rol = 'gerencia' | 'contable' | 'gestora' | 'comercial' | 'admin'
export interface Perfil {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
  /** Alta con contraseña inicial: en el primer ingreso tiene que elegir la suya. */
  debe_cambiar_clave?: boolean
}
export interface EstadoSesion {
  perfil: Perfil | null
  rol: Rol | null
  cargando: boolean
  conSesion: boolean
  error: ErrorSesion
  reintentar: () => void
  salir: () => void
}

const nada = () => {}
const Contexto = createContext<EstadoSesion>({
  perfil: null, rol: null, cargando: true, conSesion: false, error: null, reintentar: nada, salir: nada,
})

type Datos = Pick<EstadoSesion, 'perfil' | 'rol' | 'cargando' | 'error'>

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [datos, setDatos] = useState<Datos>({ perfil: null, rol: null, cargando: true, error: null })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session === undefined ? undefined : (session?.user.id ?? null)
  useEffect(() => {
    if (userId === undefined) return
    if (userId === null) {
      // Conserva el aviso de usuario inactivo después del signOut automático.
      setDatos((d) => ({ perfil: null, rol: null, cargando: false, error: d.error === 'inactivo' ? 'inactivo' : null }))
      return
    }
    let vigente = true
    setDatos((d) => ({ ...d, cargando: true, error: null }))
    supabase
      .from('perfiles')
      .select('id,nombre,rol,activo,debe_cambiar_clave')
      .eq('id', userId)
      .maybeSingle()
      .then(
        (r) => resolverPerfil(r),
        (e: unknown) => resolverPerfil({ data: null, error: e ?? 'error' }),
      )
      .then((res) => {
        if (!vigente) return
        setDatos({ ...res, cargando: false })
        if (res.error === 'inactivo') void supabase.auth.signOut()
      })
    return () => {
      vigente = false
    }
  }, [userId, intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  const salir = useCallback(() => {
    setDatos((d) => ({ ...d, error: null }))
    void supabase.auth.signOut()
  }, [])

  return (
    <Contexto.Provider value={{ ...datos, conSesion: !!session, reintentar, salir }}>{children}</Contexto.Provider>
  )
}

export function useSesion(): EstadoSesion {
  return useContext(Contexto)
}
