import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/** Refresca las consultas indicadas ante cualquier cambio en trámites, presupuestos o movimientos. */
export function useFinanzasEnVivo(canalNombre: string, clave: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const invalidar = () => qc.invalidateQueries({ queryKey: [clave] })
    const canal = supabase.channel(canalNombre)
    for (const table of ['tramites', 'presupuestos', 'movimientos'])
      canal.on('postgres_changes', { event: '*', schema: 'public', table }, invalidar)
    canal.subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [qc, canalNombre, clave])
}
