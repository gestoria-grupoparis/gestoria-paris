// Lectura de fotos reales por OCR. Los fixtures *-ocr-* salen de fotos reales leídas con
// Tesseract y están anonimizados: nombres, documentos, CUIT, dominios y números de control
// inventados, pero con el mismo ruido y los mismos errores del OCR.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  clasificar, combinarLecturas, combinarPlanillas, extraer, limpiarLinea, parsearPlanilla, parsearPlanillaOcr, type LineaOcr,
} from './parsers'

const fixture = (n: string) => readFileSync(join(__dirname, '__fixtures__', n), 'utf8')
const suma = (xs: { importe_cents: bigint }[]) => xs.reduce((a, l) => a + l.importe_cents, 0n)

test('limpiarLinea corrige O/0, I/1 y "S" por "$" dentro de importes', () => {
  expect(limpiarLinea('S 32.5OO,OO')).toBe('$ 32.500,00')
  expect(limpiarLinea('$ 1.l63.855,24')).toBe('$ 1.163.855,24')
  expect(limpiarLinea('Exp. cédula O km $ 5290,00')).toBe('Exp. cédula O km $ 5290,00')
})

describe('retención de sellos (foto)', () => {
  const a = extraer(fixture('retencion-ocr-1.txt'))
  const b = extraer(fixture('retencion-ocr-2.txt'))
  test('cada lectura sola deja algo sin leer, nunca un dato equivocado', () => {
    expect(a.total_cents).toBeNull() // "Total Retenido: _ 950861429" no es un importe válido
    expect(b.total_cents).toBe(50861429n)
  })
  test('combinadas: todos los campos', () => {
    const e = combinarLecturas([a, b])
    expect(e).toMatchObject({
      tipo: 'retencion_sellos', numero: '0000123456', emisor_cuit: '27111111114', fecha: '2026-06-30',
      total_cents: 50861429n, dominio: 'AC111BD', nombre: 'PEREZ JUAN CARLOS', documento: '20111222',
    })
    expect(e.dudosos).toEqual([])
  })
})

describe('recibo DNRPA (foto)', () => {
  const lecturas = ['bn', 'gris', 'tabla'].map((v) => extraer(fixture(`recibo-ocr-${v}.txt`)))
  test('combinadas: fecha, total, emisor y 9 líneas que suman el total', () => {
    const e = combinarLecturas(lecturas)
    expect(e.tipo).toBe('recibo_dnrpa')
    expect(e.numero).toBe('654321')
    expect(e.fecha).toBe('2026-07-01') // una lectura dice 04/07: gana la mayoría
    expect(e.emisor).toBe('Registro 19008 SAN LUIS N° 3')
    expect(e.total_cents).toBe(43153969n)
    expect(e.lineas).toHaveLength(9)
    expect(e.lineas.filter((l) => l.importe_cents < 0n)).toHaveLength(3)
    expect(suma(e.lineas)).toBe(43153969n)
    expect(e.dudosos).not.toContain('lineas')
    expect(e.lineas[0]).toEqual({ concepto: 'INSCRIPCION INICIAL NACIONAL', importe_cents: 38814517n })
  })
  test('dos lecturas que no coinciden en la fecha la dejan vacía y dudosa', () => {
    const e = combinarLecturas([lecturas[0], lecturas[2]])
    expect(e.fecha).toBeNull()
    expect(e.dudosos).toContain('fecha')
  })
})

test('factura C manuscrita: queda pendiente, solo el CUIT impreso del emisor', () => {
  const t = [
    'C F A C T U R A', 'ORIGINAL 00010391', 'N° 0001 -', 'CUIT: 27-11111111-4',
    'SEÑOR(es): ...... GoDy ManO EsTEBn', 'TOTAL £32Soo',
    'CUIT: 20-22222222-3 - ING. BRUTOS: 12-20-22222222-3 CAI: 52012216463669',
    'DESDE: 0001 - 00010251 HASTA: 0001 - 00010750 ORIGINAL BLANCO - DUPLICADO',
  ].join('\n')
  expect(clasificar(t)).toBe('factura_honorarios')
  const e = extraer(t)
  expect(e.emisor_cuit).toBe('27111111114')
  expect(e.numero).toBe('0001-00010391') // no el rango de la imprenta
  expect(e).toMatchObject({ total_cents: null, nombre: null, fecha: null })
  expect(e.dudosos).toEqual(expect.arrayContaining(['total', 'nombre', 'fecha']))
})

describe('planilla (foto, cinco lecturas)', () => {
  const datos = JSON.parse(fixture('planilla-ocr-lecturas.json')) as { pagos_verdaderos_cents: string[]; lecturas: Record<string, LineaOcr[]> }
  const verdad = datos.pagos_verdaderos_cents.map(BigInt)
  const r = combinarPlanillas(Object.values(datos.lecturas).map((l) => parsearPlanillaOcr(l)))
  test('ningún pago en la fila equivocada y al menos 90% de las filas con su pago', () => {
    expect(r.filas.length).toBe(verdad.length)
    let bien = 0
    r.filas.forEach((f, i) => {
      if (f.pago_cents === null) return expect(f.dudoso).toBe(true)
      expect(f.pago_cents, `fila ${i + 1} ${f.nombre}`).toBe(verdad[i])
      bien++
    })
    expect(bien / verdad.length).toBeGreaterThanOrEqual(0.9)
  })
})

const palabra = (texto: string, x0: number, y0: number, ancho = 120, alto = 40) => ({ texto, x0, y0, x1: x0 + ancho, y1: y0 + alto })
const linea = (palabras: ReturnType<typeof palabra>[]): LineaOcr => ({
  texto: palabras.map((p) => p.texto).join(' '),
  x0: Math.min(...palabras.map((p) => p.x0)), y0: Math.min(...palabras.map((p) => p.y0)),
  x1: Math.max(...palabras.map((p) => p.x1)), y1: Math.max(...palabras.map((p) => p.y1)),
  palabras,
})
const renglon = (y: number, nombre: string, pago: string, hon: string, dyImportes = 0) =>
  linea([
    ...nombre.split(' ').map((n, i) => palabra(n, 100 + i * 160, y)),
    palabra('$', 1000, y + dyImportes, 20), palabra(pago, 1030, y + dyImportes, 250),
    palabra('$', 1500, y + dyImportes, 20), palabra(hon, 1530, y + dyImportes, 220),
  ])

describe('planilla: regla de seguridad', () => {
  const enc = linea([palabra('NOMBRE', 100, 0), palabra('PAGO', 1050, 0), palabra('HONORARIOS', 1500, 0, 250)])
  test('renglones derechos: nombre con sus dos importes', () => {
    const r = parsearPlanillaOcr([enc, renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'), renglon(100, 'BENITEZ HUGO', '200.000,00', '32.500,00')])
    expect(r.filas).toEqual([
      { nombre: 'ACOSTA ANA', dominio: null, pago_cents: 10000000n, honorarios_cents: 3250000n, dudoso: false },
      { nombre: 'BENITEZ HUGO', dominio: null, pago_cents: 20000000n, honorarios_cents: 3250000n, dudoso: false },
    ])
  })
  test('el OCR une un nombre con los importes del renglón de abajo: no se empareja', () => {
    const r = parsearPlanillaOcr([
      enc,
      renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'),
      renglon(100, 'BENITEZ HUGO', '200.000,00', '32.500,00', 45), // importes un renglón más abajo
      renglon(200, 'CABRAL INES', '300.000,00', '32.500,00'),
    ])
    expect(r.filas.find((f) => f.nombre === 'BENITEZ HUGO')).toMatchObject({ pago_cents: null, honorarios_cents: null, dudoso: true })
    expect(r.filas.find((f) => f.nombre === 'CABRAL INES')).toMatchObject({ pago_cents: 30000000n, dudoso: false })
  })
  test('importe ilegible o un solo importe: la fila sale con null, no se corre el de al lado', () => {
    const r = parsearPlanillaOcr([
      enc,
      renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'),
      renglon(100, 'BENITEZ HUGO', '368.369099|', '32.500,00'),
      linea([palabra('CABRAL', 100, 150), palabra('INES', 260, 150), palabra('$', 1500, 150, 20), palabra('32.500,00', 1530, 150, 220)]),
      renglon(200, 'DOMINGUEZ TOMAS', '400.000,00', '32.500,00'),
    ])
    expect(r.filas.map((f) => [f.nombre, f.pago_cents, f.honorarios_cents, f.dudoso])).toEqual([
      ['ACOSTA ANA', 10000000n, 3250000n, false],
      ['BENITEZ HUGO', null, 3250000n, true],
      ['CABRAL INES', null, 3250000n, true],
      ['DOMINGUEZ TOMAS', 40000000n, 3250000n, false],
    ])
  })
  test('honorarios que difieren del habitual en un dígito quedan dudosos', () => {
    const filas = ['ACOSTA ANA', 'BENITEZ HUGO', 'CABRAL INES', 'DOMINGUEZ TOMAS']
      .map((n, i) => renglon(50 + i * 50, n, '100.000,00', i === 2 ? '32.500,09' : '32.500,00'))
    expect(parsearPlanillaOcr([enc, ...filas]).filas[2]).toMatchObject({ honorarios_cents: null, dudoso: true })
  })
  test('control contra el total de la hoja', () => {
    const base = [enc, renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'), renglon(100, 'BENITEZ HUGO', '200.000,00', '32.500,00')]
    const total = (p: string) => linea([palabra('TOTAL', 100, 150), palabra('$', 1000, 150, 20), palabra(p, 1030, 150, 250), palabra('$', 1500, 150, 20), palabra('65.000,00', 1530, 150, 220)])
    expect(parsearPlanillaOcr([...base, total('300.000,00')]).cuadra).toBe(true)
    expect(parsearPlanillaOcr([...base, total('310.000,00')]).cuadra).toBe(false)
  })
  test('combinar lecturas: un importe vale solo si dos lecturas lo leen igual', () => {
    const l1 = parsearPlanillaOcr([enc, renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'), renglon(100, 'BENITEZ HUGO', '200.000,00', '32.500,00')])
    const l2 = parsearPlanillaOcr([enc, renglon(50, 'ACOSTA ANA', '100.000,00', '32.500,00'), renglon(100, 'BENITEZ HUGO', '280.000,00', '32.500,00')])
    const r = combinarPlanillas([l1, l2])
    expect(r.filas[0]).toMatchObject({ pago_cents: 10000000n, dudoso: false })
    expect(r.filas[1]).toMatchObject({ pago_cents: null, honorarios_cents: 3250000n, dudoso: true })
  })
})

test('planilla en texto: con un solo importe en la línea no se adivina la columna', () => {
  const r = parsearPlanilla('NOMBRE PAGO HONORARIOS\nACOSTA ANA $ 100.000,00 $ 32.500,00\nBENITEZ HUGO $ 32.500,00\nCABRAL INES S 300.000,00 S 32.500,00')
  expect(r.filas.map((f) => [f.nombre, f.pago_cents, f.dudoso])).toEqual([
    ['ACOSTA ANA', 10000000n, false],
    ['BENITEZ HUGO', null, true],
    ['CABRAL INES', 30000000n, false],
  ])
})
