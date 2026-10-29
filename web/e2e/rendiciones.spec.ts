import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { crearServidor, montarSupabase, type Extra, type Semilla, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }

export const GESTORA = '00000000-0000-4000-8000-000000000071'
export const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
export const PARIS_AUTOS = '00000000-0000-4000-8000-0000000000e1'

export async function abrir(page: Page, usuario: string, servidor: Servidor = crearServidor(), ruta = '/rendiciones') {
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor })
  await page.goto(ruta)
  return mock
}

async function crearJulio(page: Page) {
  await page.getByRole('button', { name: 'Nueva rendición' }).first().click()
  const d = page.getByRole('dialog', { name: 'Nueva rendición' })
  await d.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await d.getByLabel('Mes').fill('2026-07')
  await d.getByRole('button', { name: 'Crear rendición' }).click()
  return d
}

test('gestora crea la rendición de julio 2026 de Paris Autos y la ve en la lista', async ({ page }) => {
  await abrir(page, GESTORA)
  await expect(page.getByText('Todavía no hay rendiciones.')).toBeVisible()
  await crearJulio(page)
  await expect(page.getByRole('heading', { name: 'Paris Autos · Julio 2026' })).toBeVisible()
  await page.getByRole('button', { name: 'Rendiciones', exact: true }).click()
  const tabla = page.getByRole('table', { name: 'Rendiciones' })
  await expect(tabla.getByRole('row')).toHaveCount(2)
  await expect(tabla).toContainText('Paris Autos')
  await expect(tabla).toContainText('Julio 2026')
  await expect(tabla).toContainText('Borrador')
})

test('no deja crear dos veces el mismo mes', async ({ page }) => {
  await abrir(page, GESTORA)
  await crearJulio(page)
  await page.getByRole('button', { name: 'Rendiciones', exact: true }).click()
  const d = await crearJulio(page)
  await expect(d.getByRole('alert')).toHaveText('Ya existe la rendición de ese mes para esa gestora y razón social.')
})

// --- Escenario de julio 2026: tres trámites de Paris Autos y una rendición en borrador ---------
const SUCURSAL = '00000000-0000-4000-8000-0000000000d1'
const TIPO = '00000000-0000-4000-8000-0000000000f2'
export const REND = '00000000-0000-4000-8000-00000000aa01'
const CUENTA_AUTOS = catalogos.cuentas.find((c) => c.empresa_id === PARIS_AUTOS)!.id

export function tramiteSemilla(n: number, cliente: string, dominio: string | null): Semilla {
  const op = `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
  return {
    operacion: { id: op, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, cliente_nombre: cliente, cuenta_personal: `CP-${n}`, oferta_ref: `OF-${n}`, referencia_mail: null, created_at: '2026-07-01T12:00:00.000Z' },
    tramite: {
      id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`, numero: `T-2026-007${String(n).padStart(2, '0')}`,
      operacion_id: op, tipo_id: TIPO, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, estado: 'devuelto', vehiculo_desc: 'Peugeot 208',
      dominio, chasis: null, gestora_id: GESTORA, autorizado_at: '2026-07-02T12:00:00.000Z', version: 5, created_at: '2026-07-01T12:00:00.000Z',
    },
  }
}

export const T_GODOY = tramiteSemilla(1, 'GODOY MARIO ESTEBAN', 'AA111AA')
export const T_JOFRE = tramiteSemilla(2, 'JOFRE FABRICIO ALEJANDRO', 'AF869NV')
export const T_SUAREZ = tramiteSemilla(3, 'SUAREZ OSCAR RAUL', 'LZI780')

export const pago = (n: number, tramite: string, importe: string) => ({
  id: `00000000-0000-4000-8000-0000000006${String(n).padStart(2, '0')}`, cuenta_id: CUENTA_AUTOS, tipo: 'pago_tramite',
  importe: `-${importe}`, fecha_operacion: '2026-07-15', tramite_id: tramite, revierte_id: null, es_pago_final: true,
  creado_por: GESTORA, created_at: '2026-07-15T15:00:00.000Z',
})

export function escenario(extra: Extra = {}, semillas: Semilla[] = [T_GODOY, T_JOFRE, T_SUAREZ]) {
  return crearServidor(semillas, {
    rendiciones: [{ id: REND, empresa_id: PARIS_AUTOS, gestora_id: GESTORA, periodo: '2026-07-01', honorario: '3250000', estado: 'borrador', motivo_observacion: null, creado_por: GESTORA, created_at: '2026-08-01T12:00:00.000Z', version: 1 }],
    ...extra,
  })
}

test('importa la planilla desde Excel: 3 filas, vincula 2 por dominio y marca 1 sin vincular; el total suma $ 1.864.715,82', async ({ page }) => {
  // GODOY no tiene trámite en este escenario: queda sin vincular.
  await abrir(page, GESTORA, escenario({}, [T_JOFRE, T_SUAREZ]), `/rendiciones?r=${REND}`)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Julio')
  ws.addRow(['NOMBRE', 'PAGO', 'HONORARIOS'])
  ws.addRow(['GODOY MARIO ESTEBAN', 1163855.24, 32500])
  ws.addRow(['JOFRE FABRICIO ALEJANDRO AF869NV', 431539.69, 32500])
  ws.addRow(['SUAREZ OSCAR RAUL LZI780', 269320.89, 32500])
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  await page.getByLabel('Archivo de la planilla').setInputFiles({ name: 'julio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  const tabla = page.getByRole('table', { name: 'Filas de la planilla' })
  await expect(tabla.locator('tbody tr')).toHaveCount(3)
  await expect(tabla.getByText(/^Vinculado/)).toHaveCount(2)
  await expect(tabla.getByText('Sin vincular')).toHaveCount(1)
  await expect(page.getByTestId('total-pago')).toHaveText('$ 1.864.715,82')
  await page.getByRole('button', { name: 'Guardar planilla' }).click()
  await expect(page.getByText('Planilla guardada.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('table', { name: 'Filas de la planilla' }).locator('tbody tr')).toHaveCount(3)
})
