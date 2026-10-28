import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Rol = 'gerencia' | 'contable' | 'gestora' | 'comercial' | 'admin'
export interface Perfil {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
}
interface EstadoSesion {
  perfil: Perfil | null
  rol: Rol | null
  cargando: boolean
}

const Contexto = createContext<EstadoSesion>({ perfil: null, rol: null, cargando: true })

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [estado, setEstado] = useState<EstadoSesion>({ perfil: null, rol: null, cargando: true })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session === undefined ? undefined : (session?.user.id ?? null)
  useEffect(() => {
    if (userId === undefined) return
    if (userId === null) {
      setEstado({ perfil: null, rol: null, cargando: false })
      return
    }
    let vigente = true
    setEstado((e) => ({ ...e, cargando: true }))
    supabase
      .from('perfiles')
      .select('id,nombre,rol,activo')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!vigente) return
        const perfil = data && data.activo ? (data as Perfil) : null
        setEstado({ perfil, rol: perfil?.rol ?? null, cargando: false })
      })
    return () => {
      vigente = false
    }
  }, [userId])

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>
}

export function useSesion(): EstadoSesion {
  return useContext(Contexto)
}
