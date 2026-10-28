import { describe, expect, it } from 'vitest'
import { mensajeErrorLogin } from './erroresAuth'

describe('mensajeErrorLogin', () => {
  it('sin error no hay mensaje', () => expect(mensajeErrorLogin(null)).toBeNull())
  it('credenciales inválidas', () =>
    expect(mensajeErrorLogin({ message: 'Invalid login credentials', status: 400 })?.titulo).toBe('Email o contraseña incorrectos.'))
  it('por código', () => expect(mensajeErrorLogin({ code: 'invalid_credentials' })?.titulo).toMatch(/incorrectos/))
  it('email sin confirmar', () => expect(mensajeErrorLogin({ message: 'Email not confirmed' })?.titulo).toMatch(/confirmado/))
  it('límite de intentos', () => expect(mensajeErrorLogin({ message: 'x', status: 429 })?.titulo).toMatch(/intentos/))
  it('sin conexión', () => expect(mensajeErrorLogin({ message: 'Failed to fetch' })?.titulo).toMatch(/conectarnos/))
  it('genérico', () => expect(mensajeErrorLogin({ message: 'boom', status: 500 })?.titulo).toBe('No se pudo ingresar.'))
})
