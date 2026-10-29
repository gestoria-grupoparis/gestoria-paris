import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Servidor } from './mock-supabase'
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
