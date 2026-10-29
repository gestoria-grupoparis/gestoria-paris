import { describe, expect, it } from 'vitest'
import { mensajeError, SESION_VENCIDA, SIN_CONEXION } from './errores'

describe('mensajeError', () => {
  it('muestra el detalle de la base con mayúscula y punto', () => {
    expect(mensajeError({ code: 'P0001', message: 'DATO_INVALIDO: primero marcá que retiraste el legajo' })).toBe(
      'Primero marcá que retiraste el legajo.',
    )
  })
  it('traduce estados interpolados', () => {
    expect(mensajeError(new Error('TRANSICION_INVALIDA: de en_gestoria a borrador'))).not.toMatch(/en_gestoria/)
  })
  it('usa el texto por código si no hay detalle', () => {
    expect(mensajeError(new Error('SIN_PERMISO:'))).toBe('No tenés permiso para realizar esta acción.')
    expect(mensajeError(new Error('NO_AUTORIZADO: '))).toBe('Todavía no se puede hacer este paso.')
  })
  it('red, JWT y Postgres', () => {
    expect(mensajeError(new TypeError('Failed to fetch'))).toBe(SIN_CONEXION)
    expect(mensajeError({ code: 'PGRST301', message: 'JWT expired' })).toBe(SESION_VENCIDA)
    expect(mensajeError({ code: '23505', message: 'duplicate key' })).toBe('Ya existe un registro con esos datos.')
  })
  it('cae a un mensaje genérico', () => {
    expect(mensajeError(new Error('boom'))).toBe('Ocurrió un error inesperado. Intentá de nuevo.')
    expect(mensajeError(null)).toBe('Ocurrió un error inesperado. Intentá de nuevo.')
  })
})
