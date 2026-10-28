import { describe, expect, it } from 'vitest'
import { mensajeError } from './errores'

const esperados: Record<string, string> = {
  SIN_PERMISO: 'No tenés permiso para realizar esta acción.',
  VERSION_CONFLICTO: 'Otro usuario modificó este trámite. Recargá para ver los cambios.',
  TRANSICION_INVALIDA: 'El trámite no puede pasar a ese estado desde el estado actual.',
  DUPLICADO: 'Ya existe un registro con esos datos.',
  EMPRESA_DISTINTA: 'La operación mezcla datos de distintas razones sociales.',
  NO_AUTORIZADO: 'El trámite todavía no está autorizado.',
  DATO_INVALIDO: 'Hay datos inválidos. Revisá el formulario.',
  NO_ENCONTRADO: 'No se encontró el registro solicitado.',
}

describe('mensajeError', () => {
  for (const [codigo, texto] of Object.entries(esperados)) {
    it(`mapea ${codigo}`, () => {
      expect(mensajeError({ code: 'P0001', message: `${codigo}: detalle técnico` })).toBe(texto)
      expect(mensajeError(new Error(`${codigo}: x`))).toBe(texto)
    })
  }
  it('cae a un mensaje genérico', () => {
    expect(mensajeError(new Error('boom'))).toBe('Ocurrió un error inesperado. Intentá de nuevo.')
    expect(mensajeError(null)).toBe('Ocurrió un error inesperado. Intentá de nuevo.')
  })
})
