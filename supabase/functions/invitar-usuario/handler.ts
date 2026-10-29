// Lógica de la invitación, sin dependencias de Deno ni de supabase-js para poder testearla.
// index.ts la conecta con Supabase (cliente como usuario para las RPC y cliente service role para Auth).

export interface ErrorRpc {
  message: string
}

export interface Dependencias {
  /** id del usuario dueño del JWT, o null si no es válido. */
  usuarioActual: () => Promise<string | null>
  /** RPC ejecutada con el JWT de quien llama (auth.uid() = quien llama; queda como actor en la auditoría). */
  rpcComoUsuario: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorRpc | null }>
  /** auth.admin.inviteUserByEmail con service role. */
  invitar: (email: string, redirectTo: string, datos: Record<string, unknown>) => Promise<{ id: string | null; error: (ErrorRpc & { status?: number }) | null }>
  borrarUsuarioAuth: (id: string) => Promise<void>
  /** URL pública de la app (sin barra final). */
  urlApp: string
}

export interface Respuesta {
  status: number
  body: { id: string } | { error: string }
}

const ROLES = ['gerencia', 'contable', 'gestora', 'comercial', 'admin']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODIGO = /^[A-Z_]+:/

const error = (status: number, mensaje: string): Respuesta => ({ status, body: { error: mensaje } })

export async function manejarInvitacion(cuerpo: unknown, autorizacion: string | null, d: Dependencias): Promise<Respuesta> {
  if (!autorizacion?.startsWith('Bearer ')) return error(401, 'SIN_PERMISO: falta la sesión')
  const yo = await d.usuarioActual()
  if (!yo) return error(401, 'SIN_PERMISO: sesión inválida o vencida')

  const rol = await d.rpcComoUsuario('mi_rol')
  if (rol.error || (rol.data !== 'admin' && rol.data !== 'gerencia'))
    return error(403, 'SIN_PERMISO: solo administración o gerencia invitan usuarios')

  const c = (cuerpo ?? {}) as Record<string, unknown>
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : ''
  const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : ''
  const rolNuevo = typeof c.rol === 'string' ? c.rol : ''
  const alcances = Array.isArray(c.alcances) ? c.alcances : null
  if (!EMAIL.test(email)) return error(400, 'DATO_INVALIDO: email inválido')
  if (!nombre) return error(400, 'DATO_INVALIDO: el nombre es obligatorio')
  if (!ROLES.includes(rolNuevo)) return error(400, 'DATO_INVALIDO: rol inválido')
  if (!alcances) return error(400, 'DATO_INVALIDO: los alcances deben ser una lista')

  const previa = await d.rpcComoUsuario('validar_alta_usuario', { p_rol: rolNuevo, p_alcances: alcances })
  if (previa.error) return error(400, previa.error.message)

  const inv = await d.invitar(email, `${d.urlApp.replace(/\/+$/, '')}/definir-clave`, { nombre })
  if (inv.error || !inv.id) {
    const msg = inv.error?.message ?? ''
    if (/already|registered|exists/i.test(msg) || inv.error?.status === 422)
      return error(409, 'DUPLICADO: ya existe un usuario con ese email')
    return error(502, `DATO_INVALIDO: no se pudo enviar la invitación (${msg || 'sin detalle'})`)
  }

  const alta = await d.rpcComoUsuario('alta_perfil', { p_id: inv.id, p_nombre: nombre, p_rol: rolNuevo, p_alcances: alcances })
  if (alta.error) {
    // Sin perfil el usuario no podría operar: se deshace la invitación para poder reintentar.
    await d.borrarUsuarioAuth(inv.id)
    return error(400, CODIGO.test(alta.error.message) ? alta.error.message : `DATO_INVALIDO: ${alta.error.message}`)
  }
  return { status: 200, body: { id: inv.id } }
}
