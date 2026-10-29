import { expect, it } from 'vitest'
import { ETIQUETA_CONCEPTO, etiquetaConfianza, etiquetaVariacion, rangoPeriodo, aNumero } from './formato'

it('arma el rango de cada período a partir de hoy', () => {
  expect(rangoPeriodo('mes', '2026-10-29')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
  expect(rangoPeriodo('mes_anterior', '2026-10-29')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  expect(rangoPeriodo('30d', '2026-10-29')).toEqual({ desde: '2026-09-30', hasta: '2026-10-29' })
  expect(rangoPeriodo('90d', '2026-10-29')).toEqual({ desde: '2026-07-31', hasta: '2026-10-29' })
})

it('describe la variación sin inventar cuando no hay período anterior', () => {
  expect(etiquetaVariacion(null)).toBe('Sin gasto en el período anterior')
  expect(etiquetaVariacion(12.5)).toBe('+12,5 % contra el período anterior')
  expect(etiquetaVariacion(-3)).toBe('-3 % contra el período anterior')
})

it('etiquetas de conceptos y confianza', () => {
  expect(ETIQUETA_CONCEPTO.sellos_prenda).toBe('Sellos de la prenda')
  expect(etiquetaConfianza('parcial')).toBe('Parcial: hay líneas sin dato')
  expect(etiquetaConfianza('sin_valor')).toBe('Sin valor de referencia')
})

it('convierte centavos a pesos solo para dibujar', () => {
  expect(aNumero('123456')).toBe(1234.56)
  expect(aNumero(null)).toBe(0)
})
