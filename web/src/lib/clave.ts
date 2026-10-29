/** Reglas de contraseña del lado del cliente (Supabase Auth valida además el mínimo del servidor). */
export interface Requisito {
  id: 'largo' | 'letra' | 'numero' | 'comun'
  texto: string
  ok: boolean
}
export interface EvaluacionClave {
  requisitos: Requisito[]
  /** 0 vacía · 1 débil · 2 aceptable · 3 fuerte */
  nivel: 0 | 1 | 2 | 3
  etiqueta: string
  coincide: boolean
  valida: boolean
}

export const LARGO_MINIMO = 10

const OBVIAS = ['password', 'contrasena', 'contraseña', 'clave', 'qwerty', 'asdf', '123456', 'abc123', 'grupoparis', 'paris', 'gestoria', 'admin', 'bienvenido']

function esObvia(clave: string, email?: string) {
  const c = clave.toLowerCase()
  if (OBVIAS.some((o) => c.includes(o))) return true
  if (/^(.)\1+$/.test(c)) return true
  const usuario = email?.split('@')[0]?.toLowerCase()
  return !!usuario && usuario.length >= 3 && c.includes(usuario)
}

export function evaluarClave(clave: string, confirmacion: string, email?: string): EvaluacionClave {
  const requisitos: Requisito[] = [
    { id: 'largo', texto: `Al menos ${LARGO_MINIMO} caracteres`, ok: clave.length >= LARGO_MINIMO },
    { id: 'letra', texto: 'Una letra', ok: /\p{L}/u.test(clave) },
    { id: 'numero', texto: 'Un número', ok: /\d/.test(clave) },
    { id: 'comun', texto: 'Nada obvio (tu usuario, “grupoparis”, “password”…)', ok: clave.length > 0 && !esObvia(clave, email) },
  ]
  const cumple = requisitos.every((r) => r.ok)
  const extra = clave.length >= 14 || (/[^\p{L}\d]/u.test(clave) && /\p{Lu}/u.test(clave))
  const nivel: EvaluacionClave['nivel'] = !clave ? 0 : !cumple ? 1 : extra ? 3 : 2
  const coincide = clave.length > 0 && clave === confirmacion
  return {
    requisitos,
    nivel,
    etiqueta: ['', 'Débil', 'Aceptable', 'Fuerte'][nivel],
    coincide,
    valida: cumple && coincide,
  }
}

export interface MensajeClave {
  titulo: string
  detalle: string
}

export function mensajeErrorClave(error: { message?: string; status?: number; code?: string }): MensajeClave {
  const msg = (error.message ?? '').toLowerCase()
  const code = error.code ?? ''
  if (code === 'same_password' || msg.includes('different from the old'))
    return { titulo: 'La contraseña nueva es igual a la anterior.', detalle: 'Elegí una distinta a la que venías usando.' }
  if (code === 'weak_password' || msg.includes('weak'))
    return { titulo: 'La contraseña es demasiado débil.', detalle: 'Probá con una más larga, que mezcle letras y números.' }
  if (code === 'session_not_found' || code === 'reauthentication_needed' || msg.includes('session missing') || msg.includes('jwt') || error.status === 401)
    return { titulo: 'El link ya no es válido.', detalle: 'Pedí uno nuevo desde “¿Olvidaste tu contraseña?” en la pantalla de ingreso.' }
  if (error.status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || msg.includes('rate limit'))
    return { titulo: 'Demasiados intentos seguidos.', detalle: 'Esperá unos minutos antes de volver a probar.' }
  if (msg.includes('fetch') || msg.includes('network') || error.status === 0)
    return { titulo: 'No pudimos conectarnos.', detalle: 'Revisá tu conexión a internet y volvé a intentar.' }
  return { titulo: 'No se pudo guardar la contraseña.', detalle: 'Volvé a intentar en un momento. Si sigue pasando, avisale a gerencia.' }
}

/** Error que deja Supabase Auth en la URL cuando el link de invitación o recuperación no sirve. */
export function errorEnUrl(fragmento: string): 'vencido' | 'invalido' | null {
  const p = new URLSearchParams(fragmento.replace(/^[#?]/, ''))
  if (!p.get('error') && !p.get('error_code')) return null
  return p.get('error_code') === 'otp_expired' ? 'vencido' : 'invalido'
}
