import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import borrador from './fixtures/tramite-borrador.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const E1 = '00000000-0000-4000-8000-0000000000e1'
const E2 = '00000000-0000-4000-8000-0000000000e2'
const D2 = '00000000-0000-4000-8000-0000000000d2'

test('gerencia consulta usuarios con rol y alcance, y filtra por rol y por texto', async ({ page }) => {
  await montarSupabase(page, [], {
    usuario: GERENTE,
    tablaAlcances: [
      { perfil_id: CONTABLE, empresa_id: E1, sucursal_id: null },
      { perfil_id: CONTABLE, empresa_id: E2, sucursal_id: D2 },
    ],
  })
  await page.goto('/usuarios')
  await expect(page.getByRole('heading', { name: 'Usuarios y permisos' })).toBeVisible()
  const tabla = page.getByRole('table', { name: 'Usuarios' })
  const carla = tabla.getByRole('row', { name: /Carla Contable/ })
  await expect(carla).toContainText('Contable')
  await expect(carla).toContainText('Paris Autos · Todas las sucursales')
  await expect(carla).toContainText('Paris Cars · Rivadavia')
  await expect(tabla.getByRole('row', { name: /Gabriela Gestora/ })).toContainText('Solo los trámites que tiene asignados')
  await expect(tabla.getByRole('row', { name: /Gisela Gerente/ })).toContainText('Sin alcance')

  await page.getByRole('button', { name: /Gestora/ }).click()
  await expect(tabla.getByRole('row')).toHaveCount(3)
  await page.getByRole('button', { name: /Gestora/ }).click()
  await page.getByLabel('Buscar usuario').fill('cars')
  await expect(tabla.getByRole('row')).toHaveCount(2)
  await page.getByLabel('Buscar usuario').fill('nadie')
  await expect(page.getByText('Ningún usuario coincide')).toBeVisible()
})

test('contable no ve la sección Usuarios', async ({ page }) => {
  await montarSupabase(page, [], { usuario: CONTABLE })
  await page.goto('/usuarios')
  await expect(page).toHaveURL(/\/tramites/)
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0)
})

test('exporta los trámites visibles a un CSV para Excel', async ({ page }) => {
  await montarSupabase(page, [borrador])
  await page.goto('/tramites')
  await expect(page.getByRole('table')).toBeVisible()
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a Excel' }).click()])
  expect(descarga.suggestedFilename()).toMatch(/^tramites-\d{4}-\d{2}-\d{2}\.csv$/)
  const texto = await readFile((await descarga.path())!, 'utf8')
  const lineas = texto.replace(/^\uFEFF/, '').trim().split('\r\n')
  expect(lineas[0]).toMatch(/^Número;Fecha de alta;Estado/)
  expect(lineas).toHaveLength(2)
  expect(lineas[1]).toContain(borrador.tramite.numero)
})
