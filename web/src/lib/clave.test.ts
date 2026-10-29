import { describe, expect, it } from 'vitest'
import { evaluarClave, mensajeErrorClave, errorEnUrl } from './clave'

describe('evaluarClave', () => {
  it('vacía no es válida y no tiene nivel', () => {
    const r = evaluarClave('', '')
    expect(r.valida).toBe(false)
    expect(r.nivel).toBe(0)
  })
  it('exige 10 caracteres, letras y números', () => {
    expect(evaluarClave('abcdefghij', 'abcdefghij').requisitos.find((q) => q.id === 'numero')?.ok).toBe(false)
    expect(evaluarClave('1234567890', '1234567890').requisitos.find((q) => q.id === 'letra')?.ok).toBe(false)
    expect(evaluarClave('abc123', 'abc123').requisitos.find((q) => q.id === 'largo')?.ok).toBe(false)
  })
  it('rechaza claves obvias aunque cumplan el formato', () => {
    const r = evaluarClave('password123', 'password123')
    expect(r.valida).toBe(false)
    expect(r.requisitos.find((q) => q.id === 'comun')?.ok).toBe(false)
  })
  it('rechaza claves con el email o el nombre del grupo', () => {
    expect(evaluarClave('grupoparis2026', 'grupoparis2026').valida).toBe(false)
    expect(evaluarClave('anaperez2026x', 'anaperez2026x', 'anaperez@grupoparis.com.ar').valida).toBe(false)
  })
  it('la confirmación tiene que coincidir', () => {
    const r = evaluarClave('Tornillo-Verde-42', 'Tornillo-Verde-41')
    expect(r.coincide).toBe(false)
    expect(r.valida).toBe(false)
  })
  it('clave fuerte y confirmada es válida', () => {
    const r = evaluarClave('Tornillo-Verde-42', 'Tornillo-Verde-42')
    expect(r.valida).toBe(true)
    expect(r.nivel).toBe(3)
    expect(r.etiqueta).toBe('Fuerte')
  })
  it('clave mínima aceptable tiene nivel medio', () => {
    expect(evaluarClave('camion2026', 'camion2026').nivel).toBe(2)
  })
})

describe('mensajeErrorClave', () => {
  it('misma clave', () => {
    expect(mensajeErrorClave({ code: 'same_password', message: 'x' }).titulo).toMatch(/igual a la anterior/)
  })
  it('clave débil del servidor', () => {
    expect(mensajeErrorClave({ code: 'weak_password', message: 'x' }).titulo).toMatch(/débil/)
  })
  it('sesión vencida', () => {
    expect(mensajeErrorClave({ message: 'Auth session missing!' }).titulo).toMatch(/link/)
  })
  it('red', () => {
    expect(mensajeErrorClave({ message: 'Failed to fetch' }).titulo).toMatch(/conectarnos/)
  })
})

describe('errorEnUrl', () => {
  it('detecta link vencido en el hash', () => {
    expect(errorEnUrl('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toBe('vencido')
  })
  it('detecta otros errores', () => {
    expect(errorEnUrl('#error=server_error')).toBe('invalido')
    expect(errorEnUrl('?error=access_denied&error_code=bad')).toBe('invalido')
  })
  it('sin error', () => {
    expect(errorEnUrl('#access_token=x&type=recovery')).toBeNull()
    expect(errorEnUrl('')).toBeNull()
  })
})
