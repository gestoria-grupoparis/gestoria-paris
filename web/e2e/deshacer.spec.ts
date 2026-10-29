// Corregir clics por error: cada paso se deshace con motivo, desde la empresa y desde la gestora.
import { expect, test, type Page } from '@playwright/test'
import { montarSupabase, type Semilla } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const CARLA = '00000000-0000-4000-8000-0000000000c1'
const GABRIELA = '00000000-0000-4000-8000-000000000071'
const ID = f.autorizado.id

test.use({ viewport: { width: 1440, height: 900 } })

async function panel(page: Page, semilla: Semilla) {
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [semilla], { usuario: CARLA })
  await page.goto(`/tramites?t=${ID}`)
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(detalle.getByRole('heading', { name: 'T-2026-00011' })).toBeVisible()
  return { detalle, mock }
}

async function confirmarConMotivo(page: Page, titulo: string, boton: string, motivo: string) {
  const d = page.getByRole('dialog', { name: titulo })
  await d.getByRole('button', { name: boton }).click()
  await expect(d.getByRole('alert')).toBeVisible() // sin motivo no deja
  await d.getByLabel('Motivo').fill(motivo)
  await d.getByRole('button', { name: boton }).click()
  await expect(d).toBeHidden()
}

test('la empresa quita una marca puesta por error y la vuelve a poner', async ({ page }) => {
  const { detalle, mock } = await panel(page, { operacion: f.operacion, tramite: f.autorizado })
  const marcas = detalle.getByRole('list', { name: 'Marcas documentales' })
  await marcas.getByRole('button', { name: 'Marcar entregado' }).click()
  await marcas.getByRole('button', { name: 'Quitar entregado' }).click()
  await confirmarConMotivo(page, 'Quitar marca: Entregado', 'Quitar marca', 'lo toqué sin querer')
  await expect(marcas.getByRole('button', { name: 'Marcar entregado' })).toBeVisible()
  await marcas.getByRole('button', { name: 'Marcar entregado' }).click()
  await expect(marcas.getByRole('button', { name: 'Quitar entregado' })).toBeVisible()
  expect(mock.rutasPedidas.filter((r) => r.endsWith('/rpc/desmarcar'))).toHaveLength(1)
})

test('la empresa vuelve un paso atrás un trámite presentado por error', async ({ page }) => {
  const { detalle } = await panel(page, { operacion: f.operacion, tramite: { ...f.autorizado, estado: 'presentado' }, presupuestos: ['70000000'], aprobado: true })
  await detalle.getByRole('button', { name: 'Volver a sin presentar' }).click()
  await confirmarConMotivo(page, 'Volver a sin presentar', 'Confirmar', 'todavía no fue al registro')
  await expect(detalle.getByTestId('estado')).toHaveText('Autorizado')
})

test('la empresa reabre un trámite cerrado por error', async ({ page }) => {
  const { detalle } = await panel(page, { operacion: f.operacion, tramite: { ...f.autorizado, estado: 'cerrado' } })
  await detalle.getByRole('button', { name: 'Reabrir trámite' }).click()
  await confirmarConMotivo(page, 'Reabrir trámite', 'Confirmar', 'se cerró sin querer')
  await expect(detalle.getByTestId('estado')).toHaveText('Devuelto')
})

test('la empresa retira una aprobación hecha por error y la vuelve a dar', async ({ page }) => {
  const { detalle } = await panel(page, { operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'], aprobado: true })
  await detalle.getByRole('button', { name: 'Retirar aprobación' }).click()
  await confirmarConMotivo(page, 'Retirar aprobación', 'Retirar aprobación', 'aprobé el equivocado')
  await detalle.getByRole('button', { name: 'Aprobar presupuesto' }).click()
  await page.getByRole('dialog', { name: 'Aprobar presupuesto' }).getByRole('button', { name: 'Confirmar aprobación' }).click()
  await expect(detalle.getByRole('button', { name: 'Retirar aprobación' })).toBeVisible()
})

test('sin fondos no se ofrece aprobar: explica qué hacer', async ({ page }) => {
  const { detalle } = await panel(page, { operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'], situacion: 'sin_fondos' })
  await expect(detalle).toContainText('No hay fondos para aprobarlo')
  await expect(detalle.getByRole('button', { name: 'Aprobar presupuesto' })).toHaveCount(0)
})

test.describe('gestora (móvil)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('deshace "retiré el legajo", "presentado", "finalizado" y "devuelto"', async ({ page }) => {
    await montarSupabase(page, [{ operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'], aprobado: true }], { usuario: GABRIELA })
    await page.goto('/mis-tramites')
    const t = (grupo: string) => page.getByRole('region', { name: grupo }).getByRole('article', { name: /T-2026-00011/ })
    const deshacer = async (grupo: string, boton: string, motivo: string) => {
      await t(grupo).getByRole('button', { name: boton }).click()
      await confirmarConMotivo(page, boton, 'Deshacer', motivo)
    }

    await t('Retirar y presentar').getByRole('button', { name: 'Retiré el legajo' }).click()
    await deshacer('Retirar y presentar', 'Deshacer: no retiré el legajo', 'todavía no pasé')
    await expect(t('Retirar y presentar').getByRole('button', { name: 'Retiré el legajo' })).toBeVisible()

    await t('Retirar y presentar').getByRole('button', { name: 'Retiré el legajo' }).click()
    await t('Retirar y presentar').getByRole('button', { name: 'Marcar presentado' }).click()
    await deshacer('Presentados', 'Deshacer: no lo presenté', 'me equivoqué de trámite')
    await t('Retirar y presentar').getByRole('button', { name: 'Marcar presentado' }).click()
    await t('Presentados').getByRole('button', { name: 'Marcar finalizado' }).click()
    await deshacer('Para devolver', 'Deshacer: el registro no terminó', 'falta una firma')
    await t('Presentados').getByRole('button', { name: 'Marcar finalizado' }).click()
    await t('Para devolver').getByRole('button', { name: 'Marcar devuelto' }).click()
    await deshacer('Esperando cierre', 'Deshacer: no lo devolví', 'lo tengo yo todavía')
    await expect(t('Para devolver')).toBeVisible()
  })
})
