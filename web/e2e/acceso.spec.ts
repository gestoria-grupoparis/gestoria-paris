import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'

const SUPABASE_URL = 'http://supabase.e2e.test'
const GABRIELA = '00000000-0000-4000-8000-000000000071'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'

test('login muestra error claro con credenciales inválidas y no ofrece registro', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/**`, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/auth/v1/token'))
      return route.fulfill({ status: 400, json: { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' } })
    return route.fulfill({ status: 404, json: {} })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible()
  await expect(page.getByText(/registr[aá]te|crear cuenta/i)).toHaveCount(0)

  await page.getByLabel('Email').fill('nadie@grupoparis.com.ar')
  await page.getByLabel('Contraseña', { exact: true }).fill('mal')
  await page.getByRole('button', { name: 'Mostrar contraseña' }).click()
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('alert')).toContainText('Email o contraseña incorrectos.')
})

test('shell de escritorio muestra usuario, rol y empresa', async ({ page }) => {
  await montarSupabase(page, [], { usuario: CONTABLE })
  await page.goto('/')
  const aside = page.getByRole('complementary')
  await expect(aside).toContainText('Contable · Grupo Paris')
  await expect(aside.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 375, height: 812 } })
  test('cuenta en hoja inferior con cerrar sesión', async ({ page }) => {
    await montarSupabase(page, [], { usuario: GABRIELA })
    await page.goto('/')
    await page.getByRole('button', { name: 'Tu cuenta' }).click()
    const hoja = page.getByRole('dialog', { name: 'Tu cuenta' })
    await expect(hoja).toContainText('Gestora · Grupo Paris')
    await hoja.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible()
  })
})
