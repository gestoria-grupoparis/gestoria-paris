import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { centavosANumero, nombreConFecha, planillaACsv, planillaAXlsx, type Columna } from './planilla'

type F = { n: string; monto: string | null }
const COLS: Columna<F>[] = [
  { titulo: 'Nombre', valor: (f) => f.n },
  { titulo: 'Monto', valor: (f) => f.monto, moneda: true },
]

describe('centavosANumero', () => {
  it('divide el string de centavos sin aritmética de punto flotante', () => {
    expect(centavosANumero('65000050')).toBe(650000.5)
    expect(centavosANumero('5')).toBe(0.05)
    expect(centavosANumero('-120000')).toBe(-1200)
    expect(centavosANumero('-0')).toBe(0)
    expect(centavosANumero(null)).toBeNull()
    expect(() => centavosANumero('1.5')).toThrow()
  })
  it('rechaza importes que un número de Excel no puede representar exacto', () => {
    expect(() => centavosANumero('123456789012345678901')).toThrow(/demasiado grande/)
  })
})

describe('planillaACsv', () => {
  it('usa ; , BOM, CRLF, decimal con coma y neutraliza fórmulas', () => {
    const csv = planillaACsv(COLS, [{ n: '=HYPERLINK("x")', monto: '-150' }, { n: 'a;b', monto: null }])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['Nombre;Monto', `"'=HYPERLINK(""x"")";-1,50`, '"a;b";', ''])
  })
})

describe('planillaAXlsx', () => {
  it('escribe montos como número con formato de moneda y encabezado fijo', async () => {
    const datos = await planillaAXlsx(COLS, [{ n: 'Uno', monto: '65000050' }, { n: 'Dos', monto: null }], 'Trámites')
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(datos)
    const hoja = libro.getWorksheet('Trámites')!
    expect(hoja.getRow(1).values).toEqual([undefined, 'Nombre', 'Monto'])
    expect(hoja.getRow(1).font?.bold).toBe(true)
    expect(hoja.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    const c = hoja.getCell('B2')
    expect(c.value).toBe(650000.5)
    expect(c.numFmt).toContain('#,##0.00')
    expect(hoja.getCell('B3').value).toBeNull()
  })
})

describe('nombreConFecha', () => {
  it('arma el nombre con prefijo, fecha y extensión', () => {
    expect(nombreConFecha('extracto-paris-autos', '2026-10-29', 'xlsx')).toBe('extracto-paris-autos-2026-10-29.xlsx')
    expect(nombreConFecha('Extracto París Autos S.A.', '2026-10-29', 'csv')).toBe('extracto-paris-autos-s-a-2026-10-29.csv')
  })
})
