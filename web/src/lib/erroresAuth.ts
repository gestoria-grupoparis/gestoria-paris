/** Traduce errores de Supabase Auth a mensajes claros para el login. */
export interface MensajeLogin {
  titulo: string
  detalle: string
}

export function mensajeErrorLogin(error: { message?: string; status?: number; code?: string } | null | undefined): MensajeLogin | null {
  if (!error) return null
  const msg = (error.message ?? '').toLowerCase()
  const code = error.code ?? ''
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return { titulo: 'Email o contraseña incorrectos.', detalle: 'Revisá que el email esté bien escrito y que no tengas las mayúsculas activadas.' }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed'))
    return { titulo: 'Tu email todavía no está confirmado.', detalle: 'Buscá el correo de confirmación en tu bandeja (y en spam) o pedile a gerencia que te lo reenvíe.' }
  if (error.status === 429 || code === 'over_request_rate_limit' || msg.includes('rate limit') || msg.includes('too many'))
    return { titulo: 'Demasiados intentos seguidos.', detalle: 'Esperá unos minutos antes de volver a probar.' }
  if (code === 'user_banned' || msg.includes('banned'))
    return { titulo: 'Tu usuario está bloqueado.', detalle: 'Pedile a gerencia que lo revise.' }
  if (msg.includes('fetch') || msg.includes('network') || error.status === 0)
    return { titulo: 'No pudimos conectarnos.', detalle: 'Revisá tu conexión a internet y volvé a intentar.' }
  return { titulo: 'No se pudo ingresar.', detalle: 'Volvé a intentar en un momento. Si sigue pasando, avisale a gerencia.' }
}
