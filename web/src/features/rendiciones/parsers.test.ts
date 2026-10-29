import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { clasificar, extraer, parsearPlanilla } from './parsers'

const fixture = (n: string) => readFileSync(join(__dirname, '__fixtures__', n), 'utf8')
const suma = (xs: { importe_cents: bigint }[]) => xs.reduce((a, l) => a + l.importe_cents, 0n)

describe('recibo DNRPA', () => {
  const t = fixture('recibo-dnrpa.txt')
  test('clasifica y extrae', () => {
    expect(clasificar(t)).toBe('recibo_dnrpa')
    const e = extraer(t)
    expect(e.total_cents).toBe(43153969n)
    expect(e.numero).toBe('654321')
    expect(e.fecha).toBe('2026-07-01')
    expect(e.emisor).toBe('Registro 19008 SAN LUIS N° 3')
    expect(e.dominio).toBe('AA111AA')
    expect(e.lineas).toHaveLength(9)
    expect(e.lineas.filter((l) => l.importe_cents < 0n)).toHaveLength(3)
    expect(suma(e.lineas)).toBe(43153969n)
    expect(e.dudosos).not.toContain('lineas')
  })
  test('si las líneas no suman el total, quedan dudosas', () => {
    const e = extraer(t.replace('$ -1790,00      1        $ -1790,00', '$ -1790,00      1        $ -1700,00'))
    expect(e.dudosos).toContain('lineas')
  })
})

test('retención de sellos', () => {
  const t = fixture('retencion-sellos.txt')
  expect(clasificar(t)).toBe('retencion_sellos')
  const e = extraer(t)
  expect(e).toMatchObject({
    tipo: 'retencion_sellos', total_cents: 50861429n, dominio: 'AA111AA', numero: '0000123457',
    fecha: '2026-06-30', emisor: 'DPIP San Luis', emisor_cuit: '27111111114',
    nombre: 'PEREZ JUAN CARLOS', documento: '20111222',
  })
  expect(e.lineas).toEqual([{ concepto: 'Impuesto de Sellos', importe_cents: 50861429n }])
  expect(e.dudosos).toEqual([])
})

test('factura de honorarios', () => {
  const t = fixture('factura-c.txt')
  expect(clasificar(t)).toBe('factura_honorarios')
  const e = extraer(t)
  expect(e).toMatchObject({
    total_cents: 3250000n, numero: '0001-00010391', fecha: '2026-07-05', nombre: 'PEREZ JUAN CARLOS',
  })
})

test('planilla', () => {
  const { filas, cuadra } = parsearPlanilla(fixture('planilla.txt'))
  expect(filas).toHaveLength(3)
  expect(cuadra).toBe(true)
  expect(filas[0]).toEqual({ nombre: 'PEREZ JUAN CARLOS', dominio: null, pago_cents: 116385524n, honorarios_cents: 3250000n, dudoso: false })
  expect(filas[1]).toMatchObject({ nombre: 'ACOSTA BRUNO DANIEL', dominio: 'AF869NV', pago_cents: 43153969n })
  expect(filas[2]).toMatchObject({ dominio: 'LZI780', pago_cents: 26932089n })
})

test('texto ilegible', () => {
  const e = extraer('%%% ###')
  expect(e.tipo).toBe('otro')
  expect(e.total_cents).toBeNull()
  expect(e.dudosos).toContain('total')
})
