// Accesibilidad automática (axe): 0 violaciones serias o críticas en las pantallas principales.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const GABRIELA = '00000000-0000-4000-8000-000000000071'
const semilla = [
  { operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'] },
  { operacion: f.operacion, tramite: f.presentado, presupuestos: ['70000000'] },
]

async function sinViolaciones(page: Page, donde: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const graves = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(graves, donde).toEqual([])
}

test.beforeEach(async ({ page }) => page.clock.setFixedTime(catalogos.ahora))

test('login sin violaciones', async ({ page }) => {
  await montarSupabase(page, [], { sinSesion: true })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Ingresar/ })).toBeVisible()
  await sinViolaciones(page, 'login')
})

for (const ruta of ['/tablero', '/tramites', '/habitualista', '/informes', '/usuarios'])
  test(`${ruta} sin violaciones`, async ({ page }) => {
    await montarSupabase(page, semilla)
    await page.goto(ruta)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await sinViolaciones(page, ruta)
  })

test('mis trámites y un diálogo abierto sin violaciones', async ({ page }) => {
  await montarSupabase(page, semilla, { usuario: GABRIELA })
  await page.goto('/mis-tramites')
  await page.waitForLoadState('networkidle')
  await sinViolaciones(page, '/mis-tramites')
  await page.getByRole('button', { name: 'Registrar pago' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await sinViolaciones(page, 'diálogo registrar pago')
})
