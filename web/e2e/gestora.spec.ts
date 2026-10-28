import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const GABRIELA = '00000000-0000-4000-8000-000000000071'

test.use({ viewport: { width: 375, height: 812 } })

test('gestora carga presupuesto 700.000 y lo ve en Listos para presentar', async ({ page }) => {
  await montarSupabase(page, [{ operacion: f.operacion, tramite: f.autorizado }], { usuario: GABRIELA })
  await page.goto('/')
  await expect(page).toHaveURL(/\/mis-tramites$/)

  const presupuestar = page.getByRole('region', { name: 'Presupuestar' })
  const tarjeta = presupuestar.getByRole('article', { name: /T-2026-00011/ })
  await expect(tarjeta).toContainText('Lucía Funes')
  await expect(tarjeta).toContainText('Fiat Cronos Drive')
  await expect(tarjeta).toContainText('AF200BB')

  await tarjeta.getByRole('button', { name: 'Cargar presupuesto' }).click()
  const form = page.getByRole('dialog', { name: 'Cargar presupuesto' })
  await form.getByLabel('Arancel').fill('700.000')
  await form.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(form).toBeHidden()

  await expect(presupuestar).toBeHidden()
  const listos = page.getByRole('region', { name: 'Listos para presentar' })
  const enListos = listos.getByRole('article', { name: /T-2026-00011/ })
  await expect(enListos.getByTestId('presupuesto')).toHaveText('$ 700.000,00')
  await expect(enListos.getByRole('button', { name: 'Marcar presentado' })).toBeEnabled()
})

test('gestora registra pago final 650.000 y el trámite muestra pagado', async ({ page }) => {
  await montarSupabase(page, [{ operacion: f.operacion, tramite: f.presentado, presupuestos: ['70000000'] }], { usuario: GABRIELA })
  await page.goto('/mis-tramites')

  const tarjeta = page.getByRole('region', { name: 'Presentados' }).getByRole('article', { name: /T-2026-00012/ })
  await tarjeta.getByRole('button', { name: 'Registrar pago' }).click()
  const form = page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(form.getByTestId('presupuesto-referencia')).toHaveText('$ 700.000,00')
  await expect(form.getByLabel('¿Es el pago final?')).toBeChecked()
  await form.getByLabel('Arancel').fill('650.000')
  await form.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(form).toBeHidden()

  await expect(tarjeta.getByTestId('situacion')).toHaveText('Pagado')
  await expect(tarjeta.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
})

test('gestora no ve el menú Habitualista ni importes de saldo', async ({ page }) => {
  const mock = await montarSupabase(
    page,
    [{ operacion: f.operacion, tramite: f.autorizado, presupuestos: ['90000000'], situacion: 'sin_fondos' }],
    { usuario: GABRIELA },
  )
  await page.goto('/mis-tramites')

  const tarjeta = page.getByRole('region', { name: 'Listos para presentar' }).getByRole('article', { name: /T-2026-00011/ })
  await expect(tarjeta.getByRole('alert')).toHaveText('No presentar: sin fondos')
  await expect(tarjeta.getByRole('button', { name: 'Marcar presentado' })).toBeDisabled()

  const nav = page.getByRole('navigation', { name: 'Principal móvil' })
  await expect(nav.getByRole('link', { name: 'Mis trámites' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Habitualista' })).toHaveCount(0)
  await expect(page.getByText(/saldo|disponible|comprometido/i)).toHaveCount(0)
  expect(mock.rutasPedidas.filter((r) => /v_saldos|cuentas|movimientos/.test(r))).toEqual([])
})

test('gestora ve el resumen cuenta por grupo', async ({ page }) => {
  await montarSupabase(page, [{ operacion: f.operacion, tramite: f.autorizado }], { usuario: GABRIELA })
  await page.goto('/mis-tramites')
  const resumen = page.getByRole('navigation', { name: 'Resumen' })
  await expect(resumen.getByRole('link', { name: /Presupuestar/ })).toContainText('1')
  await expect(page.getByText('Próximo paso:')).toContainText('Presupuesto')
})

test('gestora sin trámites asignados ve el estado vacío', async ({ page }) => {
  await montarSupabase(page, [], { usuario: GABRIELA })
  await page.goto('/mis-tramites')
  await expect(page.getByRole('heading', { name: 'Estás al día' })).toBeVisible()
})
