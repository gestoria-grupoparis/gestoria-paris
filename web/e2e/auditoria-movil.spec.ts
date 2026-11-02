// Mejoras de la auditoría de interfaz (2/11/2026): celular a 390 px, barra con "Más" y axe sin
// violaciones serias en las pantallas corregidas.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const semilla = [
  { operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'] },
  { operacion: f.operacion, tramite: f.presentado, presupuestos: ['70000000'] },
]

test.use({ viewport: { width: 390, height: 844 } })
test.beforeEach(async ({ page }) => page.clock.setFixedTime(catalogos.ahora))

async function sinViolaciones(page: Page, donde: string) {
  await page.waitForLoadState('networkidle')
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze()
  const malas = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'heading-order')
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(malas, donde).toEqual([])
}

for (const ruta of ['/tablero', '/informes', '/habitualista', '/analisis?vista=prevision'])
  test(`axe a 390 px sin violaciones serias ni saltos de títulos: ${ruta}`, async ({ page }) => {
    await montarSupabase(page, semilla, { usuario: GERENTE, servidor: crearServidor(semilla) })
    await page.goto(ruta)
    await expect(page.getByRole('main')).toBeVisible()
    await sinViolaciones(page, ruta)
  })

test('axe a 390 px en Comprobantes vacío de una rendición', async ({ page }) => {
  await montarSupabase(page, [], { usuario: CONTABLE })
  await page.goto('/rendiciones')
  await page.getByRole('button', { name: 'Nueva rendición' }).first().click()
  const d = page.getByRole('dialog', { name: 'Nueva rendición' })
  await d.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await d.getByLabel('Mes').fill('2026-07')
  await d.getByLabel('Gestora').selectOption({ label: 'Gabriela Gestora' })
  await d.getByRole('button', { name: 'Crear rendición' }).click()
  await page.getByRole('tab', { name: 'Comprobantes' }).or(page.getByRole('button', { name: 'Comprobantes' })).first().click()
  await expect(page.getByText('Todavía no hay comprobantes.')).toBeVisible()
  await sinViolaciones(page, 'comprobantes')
})

test('la barra del celular tiene 5 accesos y "Más" abre el resto', async ({ page }) => {
  await montarSupabase(page, semilla, { usuario: GERENTE })
  await page.goto('/tablero')
  const nav = page.getByRole('navigation', { name: 'Principal móvil' })
  await expect(nav.getByRole('link')).toHaveCount(4)
  await expect(nav.getByRole('button', { name: 'Más' })).toBeVisible()
  await nav.getByRole('button', { name: 'Más' }).click()
  const hoja = page.getByRole('dialog', { name: 'Más secciones' })
  await expect(hoja.getByRole('link')).toHaveText(['Análisis', 'Rendiciones', 'Usuarios'])
  await hoja.getByRole('link', { name: 'Rendiciones' }).click()
  await expect(page).toHaveURL(/\/rendiciones/)
  await expect(hoja).toBeHidden()
  await expect(nav.getByRole('button', { name: 'Más' })).toHaveClass(/text-tinta/)
})

test('el contable ve el menú en el mismo orden pero arranca en Trámites', async ({ page }) => {
  await montarSupabase(page, semilla, { usuario: CONTABLE })
  await page.goto('/')
  await expect(page).toHaveURL(/\/tramites$/)
  await expect(page.getByRole('navigation', { name: 'Principal móvil' }).getByRole('link').first()).toHaveText('Tablero')
})

test('Trámites en el celular: degradé que avisa que hay más vistas y buscador sin cortar', async ({ page }) => {
  await montarSupabase(page, semilla, { usuario: CONTABLE })
  await page.goto('/tramites')
  await expect(page.getByTestId('mas-vistas')).toBeVisible()
  const buscar = page.getByRole('searchbox', { name: 'Buscar' })
  await expect(buscar).toHaveAttribute('placeholder', 'Cliente, cuenta, oferta o dominio')
  const cabe = await buscar.evaluate((el: HTMLInputElement) => {
    const c = document.createElement('canvas').getContext('2d')!
    c.font = getComputedStyle(el).font
    return c.measureText(el.placeholder).width <= el.clientWidth - 48
  })
  expect(cabe).toBe(true)
})

test('Nuevo trámite: empieza por la operación, recuerda el tipo y en el celular los botones quedan a la vista', async ({ page }) => {
  await montarSupabase(page, semilla, { usuario: CONTABLE })
  await page.addInitScript(() => localStorage.setItem('alta-ultima-empresa-sucursal', JSON.stringify({ tipo: 'patentamiento_0km' })))
  await page.goto('/tramites')
  await page.getByRole('button', { name: 'Nuevo trámite' }).first().click()
  const d = page.getByRole('dialog', { name: 'Nuevo trámite' })
  await expect(d.getByRole('group').first()).toContainText('Operación')
  await expect(d.locator('select, input').first()).toHaveAccessibleName('Razón social')
  await expect(d.getByLabel('Tipo')).toHaveValue('patentamiento_0km')
  await expect(d.getByRole('button', { name: 'Guardar trámite' })).toBeInViewport()
})

test('Informes: los importes en cero van en gris y avisa cuando el mes no tuvo movimientos', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await montarSupabase(page, [], { usuario: GERENTE })
  await page.goto('/informes')
  const tabla = page.getByRole('table', { name: 'Cierre mensual' })
  await expect(tabla.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveClass(/text-tenue/)
  await expect(page.getByRole('status').filter({ hasText: 'Sin movimientos en' })).toBeVisible()
})
