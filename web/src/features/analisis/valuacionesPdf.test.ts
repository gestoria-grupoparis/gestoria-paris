import { describe, expect, it } from 'vitest'
import paginas from './__fixtures__/valuaciones-disp-160-2026.json'
import { enTandas, parsearValuaciones, type Texto } from './valuacionesPdf'

// Extracto real de la tabla DNRPA Disp. 160/2026 (datos públicos), tal como lo entrega PDF.js.
const r = parsearValuaciones(paginas as Texto[][])
const valor = (mtm: string, anio: number) => r.filas.find((f) => f.mtm === mtm && f.anio === anio)?.valor_cents

describe('tabla de valuaciones DNRPA', () => {
  it('lee la vigencia del encabezado', () => {
    expect(r.vigencia).toBe('2026-10-01')
  })

  it('asigna cada valor al año de su columna, en centavos', () => {
    const f = r.filas.find((x) => x.mtm === '39014013')!
    expect(f).toMatchObject({ tipo_vehiculo: 'auto', marca: '3-STAR', modelo: 'SXZ1047W', version: 'CAMION' })
    expect(valor('39014013', 2005)).toBe('500000000')
    expect(valor('39014013', 2002)).toBe('440000000')
    expect(r.filas.filter((x) => x.mtm === '39014013')).toHaveLength(4)
  })

  it('reconoce motos y el 0 km como año 0', () => {
    expect(r.filas.find((x) => x.mtm === '06919847')?.tipo_vehiculo).toBe('moto')
    expect(valor('06919847', 0)).toBe('3117400000')
    expect(valor('06919847', 2008)).toBe('1101100000')
  })

  it('separa valores que PDF.js junta en un solo texto', () => {
    expect(valor('00402320', 0)).toBe('27027000000')
    expect(valor('00402320', 2018)).toBe('14300000000')
    expect(valor('0467949', 0)).toBe('11038027000')
    expect(valor('0467949', 2025)).toBe('9380800000')
  })

  it('separa el primer valor pegado a la descripción', () => {
    expect(r.filas.find((x) => x.mtm === 'R9382018')?.version).toBe('PICK-UP CABINA DOBLE')
    expect(valor('R9382018', 0)).toBe('8578570000')
  })

  it('no inventa valores ilegibles: los informa como error', () => {
    expect(r.filas.some((x) => x.mtm === '19521077')).toBe(false)
    expect(r.errores).toEqual(['Página 4: 19521077 no tiene valores legibles'])
  })

  it('hereda la descripción en blanco de la fila anterior', () => {
    const enc: Texto[] = [
      ['MTM/FMM', 28.8], ['T', 51.24], ['Desc. marca', 96], ['Desc. Modelo', 130.5], ['Desc. Tipo', 180.3], ['0Km', 231], ['2025', 252.7],
    ].map(([s, x]) => ({ s: s as string, x: x as number, y: 534, w: s === '0Km' ? 7.4 : (s as string).length * 2 }))
    const fila = (y: number, mtm: string, desc: string[]) => [
      { s: mtm, x: 27, y, w: 17 }, { s: 'A', x: 48.4, y, w: 2.5 },
      ...desc.map((d, i) => ({ s: d, x: [96, 131, 180][i], y, w: 20 })),
      { s: '1000000', x: 223.3, y, w: 15.2 },
    ]
    const x = parsearValuaciones([[...enc, ...fila(528, '11111111', ['MARCA', 'MODELO', 'SEDAN']), ...fila(522, '11111112', [])]])
    expect(x.filas.map((f) => [f.mtm, f.marca, f.modelo, f.version, f.anio])).toEqual([
      ['11111111', 'MARCA', 'MODELO', 'SEDAN', 0],
      ['11111112', 'MARCA', 'MODELO', 'SEDAN', 0],
    ])
  })

  it('avisa si el PDF no es la tabla', () => {
    expect(parsearValuaciones([[{ s: 'Hola', x: 0, y: 0, w: 5 }]]).errores[0]).toMatch(/No se encontraron filas/)
  })

  it('parte en tandas de 2000', () => {
    expect(enTandas(Array.from({ length: 4500 }, (_, i) => i)).map((t) => t.length)).toEqual([2000, 2000, 500])
  })
})
