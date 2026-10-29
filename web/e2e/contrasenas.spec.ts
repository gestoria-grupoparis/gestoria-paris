import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'

const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const GABRIELA = '00000000-0000-4000-8000-000000000071'
const SHOTS = process.env.CAPTURAS_DIR

test.use({ viewport: { width: 1440, height: 900 } })

test('¿Olvidaste tu contraseña? pide el link con redirect a /definir-clave y no revela si el email existe', async ({ page }) => {
  const mock = await montarSupabase(page, [], { sinSesion: true })
  await page.goto('/')
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
  await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/recuperar-1440.png`, fullPage: true })
  await page.getByLabel('Email').fill('  carla@grupoparis.com.ar ')
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await expect(page.getByRole('status')).toContainText('Si el email está registrado')
  expect(mock.recuperaciones).toHaveLength(1)
  expect(mock.recuperaciones[0].email).toBe('carla@grupoparis.com.ar')
  expect(String(mock.recuperaciones[0].redirect_to)).toMatch(/^http:\/\/localhost:\d+\/definir-clave$/)
  await page.getByRole('button', { name: 'Volver al ingreso' }).click()
  await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible()
})

test('/definir-clave desde el link: valida fuerza y confirmación, guarda y entra al sistema', async ({ page }) => {
  const mock = await montarSupabase(page, [], { usuario: CONTABLE })
  await page.goto('/definir-clave')
  await expect(page.getByRole('heading', { name: 'Definí tu contraseña' })).toBeVisible()
  const guardar = page.getByRole('button', { name: 'Guardar contraseña' })
  await page.getByLabel('Contraseña nueva').fill('password123')
  await expect(page.getByText('Débil')).toBeVisible()
  await page.getByLabel('Repetí la contraseña').fill('password123')
  await guardar.click()
  expect(mock.cambiosClave).toHaveLength(0)
  await expect(page.getByRole('alert')).toContainText('Todavía no cumple')

  await page.getByLabel('Contraseña nueva').fill('Tornillo-Verde-42')
  await page.getByLabel('Repetí la contraseña').fill('Tornillo-Verde-41')
  await expect(page.getByText('No coinciden')).toBeVisible()
  await page.getByLabel('Repetí la contraseña').fill('Tornillo-Verde-42')
  await expect(page.getByText('Fuerte')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/definir-clave-1440.png`, fullPage: true })
  await guardar.click()
  await expect(page.getByRole('heading', { name: 'Contraseña guardada' })).toBeVisible()
  expect(mock.cambiosClave.map((b) => b.password)).toEqual(['Tornillo-Verde-42'])
  await page.getByRole('button', { name: 'Ir al sistema' }).click()
  await expect(page).not.toHaveURL(/definir-clave/)
  await expect(page.getByRole('complementary')).toContainText('Contable · Grupo Paris')
})

test('/definir-clave con link vencido explica y ofrece pedir otro', async ({ page }) => {
  await montarSupabase(page, [], { sinSesion: true })
  await page.goto('/definir-clave#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await expect(page.getByRole('heading', { name: 'El link venció' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/link-vencido-1440.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pedir un link nuevo' }).click()
  await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible()
})

test('Cambiar contraseña desde el menú pide la actual y avisa si la nueva es igual', async ({ page }) => {
  const mock = await montarSupabase(page, [], { usuario: CONTABLE, claveActual: 'Vieja-Clave-2026' })
  await page.goto('/')
  await page.getByRole('complementary').getByRole('button', { name: 'Cambiar contraseña' }).click()
  await expect(page.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible()
  await page.getByLabel('Contraseña actual').fill('incorrecta')
  await page.getByLabel('Contraseña nueva').fill('Tornillo-Verde-42')
  await page.getByLabel('Repetí la contraseña').fill('Tornillo-Verde-42')
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page.getByRole('alert')).toContainText('La contraseña actual no es correcta')
  expect(mock.cambiosClave).toHaveLength(0)

  await page.getByLabel('Contraseña actual').fill('Vieja-Clave-2026')
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page.getByRole('heading', { name: 'Contraseña guardada' })).toBeVisible()
  expect(mock.cambiosClave.map((b) => b.password)).toEqual(['Tornillo-Verde-42'])
  await page.getByRole('button', { name: 'Volver' }).click()
  await expect(page.getByRole('complementary')).toBeVisible()
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 375, height: 812 } })
  test('cambiar contraseña desde la hoja de cuenta', async ({ page }) => {
    await montarSupabase(page, [], { usuario: GABRIELA })
    await page.goto('/')
    await page.getByRole('button', { name: 'Tu cuenta' }).click()
    await page.getByRole('dialog', { name: 'Tu cuenta' }).getByRole('button', { name: 'Cambiar contraseña' }).click()
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible()
    await page.getByLabel('Contraseña nueva').fill('Tornillo-Verde-42')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cambiar-clave-375.png`, fullPage: true })
  })
  test('recuperar y definir en móvil', async ({ page }) => {
    await montarSupabase(page, [], { sinSesion: true })
    await page.goto('/')
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
    await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/recuperar-375.png`, fullPage: true })
  })
  test('definir clave en móvil', async ({ page }) => {
    await montarSupabase(page, [], { usuario: GABRIELA })
    await page.goto('/definir-clave')
    await page.getByLabel('Contraseña nueva').fill('camion2026')
    await page.getByLabel('Repetí la contraseña').fill('camion2026')
    await expect(page.getByText('Aceptable')).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/definir-clave-375.png`, fullPage: true })
  })
})
