import { expect, test, type Page } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import h from './fixtures/habitualista.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const GESTORA = '00000000-0000-4000-8000-000000000071'
const T21 = h.tramite21.id
const SHOTS = process.env.SHOTS_DIR

const notif = (id: string, perfil: string, tipo: string, mensaje: string, hace: number, leida = false) => ({
  id: `00000000-0000-4000-8000-00000000f${id}`, perfil_id: perfil, tipo, tramite_id: T21, mensaje,
  created_at: new Date(Date.parse(catalogos.ahora) - hace * 60_000).toISOString(),
  leida_at: leida ? catalogos.ahora : null,
})

const semilla = [
  notif('001', GERENTE, 'sin_fondos', 'T-2026-00021 quedó sin fondos: no presentar hasta cargar fondos', 4),
  notif('002', GERENTE, 'presupuesto_cargado', 'Presupuesto cargado en T-2026-00021: listo para autorizar el pago', 12),
  notif('003', GERENTE, 'observado', 'El trámite T-2026-00022 fue observado', 60 * 26, true),
  notif('004', GESTORA, 'asignado', 'Te asignaron el trámite T-2026-00099', 2),
]

async function abrir(page: Page, usuario: string) {
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [{ operacion: h.operacion, tramite: h.tramite21, presupuestos: ['70000000'] }], { usuario, notificaciones: semilla })
  await page.goto(usuario === GESTORA ? '/mis-tramites' : '/tramites')
  return mock
}

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('gerencia ve el contador, abre el panel solo con las suyas y marca todas como leídas', async ({ page }) => {
  const mock = await abrir(page, GERENTE)
  const campana = page.getByRole('button', { name: 'Notificaciones, 2 sin leer' })
  await expect(campana).toBeVisible()
  await expect(campana.getByTestId('contador-notificaciones')).toHaveText('2')
  await campana.click()
  const panel = page.getByRole('dialog', { name: 'Notificaciones' })
  await expect(panel.getByRole('listitem')).toHaveCount(3)
  await expect(panel).toContainText('2 sin leer')
  await expect(panel).not.toContainText('T-2026-00099')
  await expect(panel).toContainText('hace 4 min')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/notificaciones-1440.png` })
  await panel.getByRole('button', { name: 'Marcar todas como leídas' }).click()
  await expect(panel).toContainText('Estás al día')
  await expect(page.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible()
  expect(mock.notificaciones.filter((n) => n.perfil_id === GERENTE && !n.leida_at)).toHaveLength(0)
  // La de la gestora no se tocó.
  expect(mock.notificaciones.find((n) => n.perfil_id === GESTORA)?.leida_at).toBeNull()
  })
})

test('abrir una notificación la marca leída y lleva al panel del trámite', async ({ page }) => {
  await abrir(page, GERENTE)
  await page.getByRole('button', { name: /^Notificaciones/ }).click()
  await page.getByRole('button', { name: /Sin leer: T-2026-00021 quedó sin fondos/ }).click()
  await expect(page).toHaveURL((u) => u.pathname === "/tramites" && u.searchParams.get("t") === T21)
  await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Notificaciones, 1 sin leer' })).toBeVisible()
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 375, height: 812 } })
  test('la gestora recibe un aviso en vivo y lo ve en la campana del encabezado', async ({ page }) => {
    const mock = await abrir(page, GESTORA)
    await expect(page.getByRole('button', { name: 'Notificaciones, 1 sin leer' })).toBeVisible()
    mock.agregarNotificacion({ id: '00000000-0000-4000-8000-00000000f005', perfil_id: GESTORA, tipo: 'sin_fondos', mensaje: 'T-2026-00099 quedó sin fondos: no presentar hasta cargar fondos' })
    await expect(page.getByRole('button', { name: 'Notificaciones, 2 sin leer' })).toBeVisible()
    await page.getByRole('button', { name: /^Notificaciones/ }).click()
    const panel = page.getByRole('dialog', { name: 'Notificaciones' })
    await expect(panel.getByRole('listitem')).toHaveCount(2)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/notificaciones-375.png` })
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })
})
