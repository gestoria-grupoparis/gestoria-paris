import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver web/.env.example).')
}

export const supabase = createClient(url, anonKey)

/** Clave de idempotencia (p_idem): generarla al abrir el formulario, no al enviarlo. */
export function nuevaIdem(): string {
  return crypto.randomUUID()
}
