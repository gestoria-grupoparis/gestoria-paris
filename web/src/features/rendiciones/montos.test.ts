import { describe, expect, test } from 'vitest'
import { parsearMonto } from './montos'

describe('parsearMonto', () => {
  test.each([
    ['$ 431539,69', 43153969n],
    ['1.163.855,24', 116385524n],
    ['$ 508 614.29', 50861429n],
    ['$ -5290,00', -529000n],
    ['32.500,00', 3250000n],
    ['1.500', 150000n],
    ['1,500', 150000n],
    ['1500', 150000n],
    ['$32.500', 3250000n],
  ])('%s => %s', (texto, cents) => {
    expect(parsearMonto(texto)).toBe(cents)
  })

  test.each(['1.50.0', '', '   ', 'abc', '1.5', '12,3456', '1..500'])('%s es inválido', (texto) => {
    expect(parsearMonto(texto)).toBeNull()
  })
})
