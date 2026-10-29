import { describe, expect, it } from 'vitest'
import { formatearPesos, parsearPesos } from './dinero'

describe('formatearPesos', () => {
  it('formatea centavos positivos', () => {
    expect(formatearPesos(235000000n)).toBe('$ 2.350.000,00')
  })
  it('formatea negativos', () => {
    expect(formatearPesos(-5000000n)).toBe('-$ 50.000,00')
  })
  it('acepta string y number', () => {
    expect(formatearPesos('5')).toBe('$ 0,05')
    expect(formatearPesos(0)).toBe('$ 0,00')
    expect(formatearPesos('900719925474099312')).toBe('$ 9.007.199.254.740.993,12')
  })
})

describe('parsearPesos', () => {
  it('parsea miles con punto', () => {
    expect(parsearPesos('650.000')).toBe(65000000n)
  })
  it('parsea sin separadores', () => {
    expect(parsearPesos('650000')).toBe(65000000n)
  })
  it('parsea decimales con coma', () => {
    expect(parsearPesos('650.000,50')).toBe(65000050n)
    expect(parsearPesos('$ 1,5')).toBe(150n)
  })
  it('rechaza texto inválido', () => {
    expect(() => parsearPesos('abc')).toThrow(/importe/i)
    expect(() => parsearPesos('')).toThrow()
    expect(() => parsearPesos('1,234')).toThrow()
    expect(parsearPesos('65.00')).toBe(6500n) // punto decimal del teclado numérico
  })
})

describe('entrada de montos', () => {
  it('acepta coma o punto decimal y rechaza basura y excesos', async () => {
    const { normalizarPesos } = await import('./dinero')
    expect(parsearPesos('1.234.567,89')).toBe(123456789n)
    expect(parsearPesos('0,1')).toBe(10n)
    expect(parsearPesos('1500.50')).toBe(150050n)
    expect(parsearPesos('1500.5')).toBe(150050n)
    expect(parsearPesos('15.000')).toBe(1500000n)
    expect(() => parsearPesos('abc')).toThrow()
    expect(() => parsearPesos('1.000.000.000.000,00')).toThrow(/máximo/)
    expect(normalizarPesos('1500.5')).toBe('1.500,50')
    expect(normalizarPesos('abc')).toBe('abc')
  })
})
