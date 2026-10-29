import ExcelJS from 'exceljs'
import { expect, test } from 'vitest'
import { importarPlanilla } from './importarExcel'

async function xlsx(filas: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Julio')
  ws.addRow(['PARIS AUTOS - RENDICION JULIO 2026'])
  for (const f of filas) ws.addRow(f)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

test('detecta NOMBRE/PAGO/HONORARIOS sin importar mayúsculas ni tildes', async () => {
  const buf = await xlsx([
    ['Nombre', 'Pago', 'Honorários'],
    ['GODOY MARIO ESTEBAN', 1163855.24, 32500],
    ['JOFRE FABRICIO ALEJANDRO AF869NV', '431.539,69', '32.500,00'],
    ['', null, null],
    ['TOTAL', 1595394.93, 65000],
  ])
  expect(await importarPlanilla(buf, 'planilla.xlsx')).toEqual([
    { nombre: 'GODOY MARIO ESTEBAN', dominio: null, pago_cents: 116385524n, honorarios_cents: 3250000n },
    { nombre: 'JOFRE FABRICIO ALEJANDRO', dominio: 'AF869NV', pago_cents: 43153969n, honorarios_cents: 3250000n },
  ])
})

test('CSV con punto y coma', async () => {
  const csv = 'NOMBRE;PAGO;HONORARIOS\nSUAREZ OSCAR RAUL LZI780;"269.320,89";32.500,00\n'
  const filas = await importarPlanilla(new TextEncoder().encode(csv).buffer as ArrayBuffer, 'p.csv')
  expect(filas).toEqual([{ nombre: 'SUAREZ OSCAR RAUL', dominio: 'LZI780', pago_cents: 26932089n, honorarios_cents: 3250000n }])
})

test('sin columnas reconocibles avisa', async () => {
  await expect(importarPlanilla(await xlsx([['a', 'b']]), 'x.xlsx')).rejects.toThrow(/NOMBRE/)
})
