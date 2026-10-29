// Edge Function: alta de usuario por invitación por email (rol admin o gerencia).
// Deploy: supabase functions deploy invitar-usuario
// Secreto opcional: APP_URL (URL pública de la app; si falta se usa el Origin del pedido).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { manejarInvitacion } from './handler.ts'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'DATO_INVALIDO: método no permitido' }), { status: 405, headers: { ...CORS, 'content-type': 'application/json' } })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const autorizacion = req.headers.get('authorization')
  const comoUsuario = createClient(url, anon, {
    global: { headers: { authorization: autorizacion ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } })
  const jwt = autorizacion?.replace(/^Bearer\s+/i, '') ?? ''

  let cuerpo: unknown = null
  try {
    cuerpo = await req.json()
  } catch {
    cuerpo = null
  }

  const r = await manejarInvitacion(cuerpo, autorizacion, {
    usuarioActual: async () => (await comoUsuario.auth.getUser(jwt)).data.user?.id ?? null,
    rpcComoUsuario: async (fn, args) => {
      const { data, error } = await comoUsuario.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
    invitar: async (email, redirectTo, datos) => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: datos })
      return { id: data.user?.id ?? null, error: error ? { message: error.message, status: error.status } : null }
    },
    borrarUsuarioAuth: async (id) => {
      await admin.auth.admin.deleteUser(id)
    },
    urlApp: Deno.env.get('APP_URL') ?? req.headers.get('origin') ?? '',
  })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, 'content-type': 'application/json' } })
})
