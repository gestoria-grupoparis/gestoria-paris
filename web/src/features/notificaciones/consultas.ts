import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { TipoNotificacion } from './formato'

export interface Notificacion {
  id: string
  tipo: TipoNotificacion
  tramite_id: string | null
  mensaje: string
  created_at: string
  leida_at: string | null
}

const CLAVE = ['notificaciones']

/** Suscripción Realtime a las notificaciones propias. Se monta una sola vez, en el shell. */
export function useNotificacionesEnVivo(perfilId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!perfilId) return
    const canal = supabase
      .channel(`notificaciones-${perfilId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificaciones', filter: `perfil_id=eq.${perfilId}` },
        () => void qc.invalidateQueries({ queryKey: CLAVE }))
      .subscribe()
    return () => void supabase.removeChannel(canal)
  }, [qc, perfilId])
}

/** Últimas 30 notificaciones propias (RLS: cada perfil ve solo las suyas). */
export function useNotificaciones(perfilId: string | undefined) {
  return useQuery({
    queryKey: CLAVE,
    enabled: !!perfilId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notificaciones')
        .select('id, tipo, tramite_id, mensaje, created_at, leida_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as Notificacion[]
    },
  })
}

/** Marca como leídas las indicadas, o todas si ids es null. */
export function useMarcarLeidas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc('marcar_notificaciones_leidas', { p_ids: ids })
      if (error) throw error
    },
    onMutate: (ids) => {
      const ahora = new Date().toISOString()
      qc.setQueryData<Notificacion[]>(CLAVE, (prev) =>
        prev?.map((n) => (!n.leida_at && (!ids || ids.includes(n.id)) ? { ...n, leida_at: ahora } : n)))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CLAVE }),
  })
}
