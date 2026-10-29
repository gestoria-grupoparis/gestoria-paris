import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { crearServidor, montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import h from './fixtures/habitualista.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const GESTORA = '00000000-0000-4000-8000-000000000071'
const T21 = h.tramite21.id

function servidor() {
  return crearServidor(
    [
      { operacion: h.operacion, tramite: { ...h.tramite21, estado: 'finalizado_registro' }, presupuestos: ['70000000'] },
      { operacion: h.operacion, tramite: h.tramite22, presupuestos: ['50000000'] },
    ],
    {
      movimientos: [
        ...h.movimientos,
        // Pago final del 21 que supera el presupuesto: 450.000 + 300.000 = 750.000 contra 700.000.
        { id: '00000000-0000-4000-8000-000000000a04', cuenta_id: h.movimientos[0].cuenta_id, tipo: 'pago_tramite', importe: '-30000000', fecha_operacion: '2026-10-20', tramite_id: T21, revierte_id: null, es_pago_final: true, creado_por: GESTORA, created_at: '2026-10-20T15:00:00.000Z' },
        { id: '00000000-0000-4000-8000-000000000a05', cuenta_id: h.movimientos[0].cuenta_id, tipo: 'carga', importe: '10000000', fecha_operacion: '2026-09-15', tramite_id: null, revierte_id: null, es_pago_final: false, creado_por: CONTABLE, created_at: '2026-09-15T15:00:00.000Z' },
      ],
    },
  )
}

async function abrir(page: Page, usuario: string) {
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [], { usuario, servidor: servidor() })
  await page.goto('/informes')
  await expect(page.getByRole('heading', { name: 'Informes' })).toBeVisible()
}

const kpi = (page: Page, nombre: string) => page.getByRole('region', { name: nombre })

test('gerencia ve el cierre mensual por razón social con saldos de apertura y cierre', async ({ page }) => {
  await abrir(page, GERENTE)
  await expect(page.getByLabel('Mes')).toHaveValue('2026-10')
  await page.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await expect(kpi(page, 'Saldo inicial').getByTestId('importe')).toHaveText('$ 100.000,00')
  await expect(kpi(page, 'Cargas').getByTestId('importe')).toHaveText('$ 2.000.000,00')
  await expect(kpi(page, 'Pagos').getByTestId('importe')).toHaveText('$ 1.050.000,00')
  await expect(kpi(page, 'Saldo final').getByTestId('importe')).toHaveText('$ 1.050.000,00')

  await page.getByLabel('Mes').selectOption('2026-09')
  await expect(kpi(page, 'Saldo inicial').getByTestId('importe')).toHaveText('$ 0,00')
  await expect(kpi(page, 'Saldo final').getByTestId('importe')).toHaveText('$ 100.000,00')

  await page.getByLabel('Razón social').selectOption({ label: 'Todas' })
  const tabla = page.getByRole('table', { name: 'Cierre mensual' })
  await expect(tabla.getByRole('row').filter({ hasText: 'Paris Autos' })).toContainText('$ 100.000,00')
})

test('costos por trámite muestran desvío contra presupuesto y se exportan', async ({ page }) => {
  await abrir(page, CONTABLE)
  await page.getByRole('tab', { name: 'Costos y desvíos' }).click()
  const tabla = page.getByRole('table', { name: 'Costos por trámite' })
  const f21 = tabla.getByRole('row').filter({ hasText: 'T-2026-00021' })
  await expect(f21.getByTestId('costo-mes')).toHaveText('$ 750.000,00')
  await expect(f21.getByTestId('desvio')).toContainText('$ 50.000,00')
  await expect(f21.getByTestId('desvio')).toContainText('+7,14 %')
  await expect(tabla.getByRole('row').filter({ hasText: 'T-2026-00022' }).getByTestId('desvio')).toHaveText('Sin pago final')

  await page.getByRole('button', { name: 'Exportar' }).click()
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Excel/ }).click()])
  expect(xlsx.suggestedFilename()).toBe('costos-octubre-2026-2026-10-28.xlsx')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await readFile((await xlsx.path())!))
  const hoja = libro.worksheets[0]
  expect(hoja.getRow(2).getCell(1).value).toBe('T-2026-00021')
  expect(hoja.getRow(2).getCell(12).value).toBe(50000)

  await page.getByLabel('Mes').selectOption('2026-08')
  await expect(page.getByText('No hubo pagos de trámites en Agosto 2026')).toBeVisible()
})

test('la gestora no ve Informes', async ({ page }) => {
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [], { usuario: GESTORA, servidor: servidor() })
  await page.goto('/informes')
  await expect(page.getByRole('heading', { name: 'Informes' })).toHaveCount(0)
})
