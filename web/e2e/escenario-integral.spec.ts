// Escenario integral (spec K / sección 14 del prompt; mismos importes que tests/db/escenario-integral.test.ts):
// contable de San Luis, gerencia de San Juan y la gestora operan sobre la misma cuenta de Paris Autos.
// Tres navegadores comparten el "servidor" simulado; cada trío de saldos se verifica en pantalla.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }

const CONTABLE_SAN_LUIS = '00000000-0000-4000-8000-0000000000c1'
// El mock no modela alcances: el perfil de gerencia del catálogo opera como gerencia de San Juan.
const GERENCIA_SAN_JUAN = '00000000-0000-4000-8000-0000000000a1'
const GESTORA = '00000000-0000-4000-8000-000000000071'

async function abrirComo(browser: Browser, servidor: Servidor, usuario: string, movil = false) {
  const ctx = await browser.newContext(movil ? { viewport: { width: 375, height: 812 } } : {})
  const page = await ctx.newPage()
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor })
  return { page, mock }
}

async function verSaldos(page: Page, registrado: string, comprometido: string, disponible: string) {
  await page.goto('/habitualista')
  const tarjeta = (nombre: string) => page.getByRole('region', { name: nombre }).getByTestId('importe')
  await expect(tarjeta('Saldo registrado')).toHaveText(registrado)
  await expect(tarjeta('Comprometido')).toHaveText(comprometido)
  await expect(tarjeta('Disponible proyectado')).toHaveText(disponible)
}

async function registrarCarga(page: Page, importe: string) {
  await page.goto('/habitualista')
  await page.getByRole('button', { name: 'Registrar carga' }).click()
  const form = page.getByRole('dialog', { name: 'Registrar carga' })
  await form.getByLabel('Importe').fill(importe)
  await form.getByLabel('Fecha de la carga').fill('2026-10-27')
  await form.getByRole('button', { name: 'Guardar carga' }).click()
  await expect(form).toBeHidden()
}

async function altaYAutorizacion(page: Page, sucursal: string, oferta: string, dominio: string, numero: string) {
  await page.goto('/tramites')
  await page.getByRole('button', { name: 'Nuevo trámite' }).click()
  const form = page.getByRole('dialog', { name: 'Nuevo trámite' })
  await form.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await form.getByLabel('Sucursal').selectOption({ label: sucursal })
  await form.getByLabel('Tipo').selectOption({ label: 'Patentamiento 0 km' })
  await form.getByLabel('Cliente').fill(`Cliente ${oferta}`)
  await form.getByLabel('Cuenta personal').fill(`CP-${oferta}`)
  await form.getByLabel('Oferta').fill(oferta)
  await form.getByLabel('Vehículo').fill('Fiat Cronos 1.3')
  await form.getByLabel('Dominio').fill(dominio)
  await form.getByRole('button', { name: 'Guardar trámite' }).click()
  await expect(form).toBeHidden()

  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(detalle.getByRole('heading', { name: numero })).toBeVisible()
  await detalle.getByRole('button', { name: 'Autorizar' }).click()
  const autorizar = page.getByRole('dialog', { name: 'Autorizar trámite' })
  await autorizar.getByLabel('Gestora').selectOption({ label: 'Gabriela Gestora' })
  await autorizar.getByRole('button', { name: 'Confirmar autorización' }).click()
  await expect(autorizar).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Autorizado')
}

async function cargarPresupuesto(page: Page, numero: string, arancel: string) {
  await page.goto('/mis-tramites')
  const tarjeta = page.getByRole('region', { name: 'Presupuestar' }).getByRole('article', { name: new RegExp(numero) })
  await tarjeta.getByRole('button', { name: 'Cargar presupuesto' }).click()
  const form = page.getByRole('dialog', { name: 'Cargar presupuesto' })
  await form.getByLabel('Arancel').fill(arancel)
  await form.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(form).toBeHidden()
}

test('escenario integral: tres usuarios y los cuatro tríos de saldos de Paris Autos', async ({ browser }) => {
  const servidor = crearServidor()
  const contable = await abrirComo(browser, servidor, CONTABLE_SAN_LUIS)
  const gerencia = await abrirComo(browser, servidor, GERENCIA_SAN_JUAN)
  const gestora = await abrirComo(browser, servidor, GESTORA, true)

  // 1. Carga de 3.000.000 y trámite de San Luis presupuestado en 700.000.
  await registrarCarga(contable.page, '3.000.000')
  await altaYAutorizacion(contable.page, 'Casa central (San Luis)', 'OF-1', 'AA001AA', 'T-2026-00001')
  await cargarPresupuesto(gestora.page, 'T-2026-00001', '700.000')
  await verSaldos(contable.page, '$ 3.000.000,00', '$ 700.000,00', '$ 2.300.000,00')

  // 2. Gerencia de San Juan suma un trámite presupuestado en 900.000.
  await altaYAutorizacion(gerencia.page, 'Rivadavia (San Juan)', 'OF-2', 'AA002AA', 'T-2026-00002')
  await cargarPresupuesto(gestora.page, 'T-2026-00002', '900.000')
  await verSaldos(gerencia.page, '$ 3.000.000,00', '$ 1.600.000,00', '$ 1.400.000,00')

  // 3. La gestora presenta el trámite de San Luis y registra el pago final de 650.000.
  await gestora.page.goto('/mis-tramites')
  await gestora.page.getByRole('region', { name: 'Listos para presentar' })
    .getByRole('article', { name: /T-2026-00001/ }).getByRole('button', { name: 'Marcar presentado' }).click()
  const presentado = gestora.page.getByRole('region', { name: 'Presentados' }).getByRole('article', { name: /T-2026-00001/ })
  await presentado.getByRole('button', { name: 'Registrar pago' }).click()
  const pago = gestora.page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(pago.getByLabel('¿Es el pago final?')).toBeChecked()
  await pago.getByLabel('Arancel').fill('650.000')
  await pago.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(pago).toBeHidden()
  await expect(presentado.getByTestId('situacion')).toHaveText('Pagado')
  await verSaldos(contable.page, '$ 2.350.000,00', '$ 900.000,00', '$ 1.450.000,00')

  // 4. Nueva carga de 2.000.000.
  await registrarCarga(contable.page, '2.000.000')
  await verSaldos(contable.page, '$ 4.350.000,00', '$ 900.000,00', '$ 3.450.000,00')
  await verSaldos(gerencia.page, '$ 4.350.000,00', '$ 900.000,00', '$ 3.450.000,00')

  // 5. La gestora no ve en ninguna pantalla el importe cobrado al cliente (Etapa 2) ni saldos.
  await gestora.page.goto('/mis-tramites')
  await expect(gestora.page.getByRole('article', { name: /T-2026-00002/ })).toBeVisible()
  await expect(gestora.page.getByText(/cobrad|cobro|saldo|disponible/i)).toHaveCount(0)
  await expect(gestora.page.getByRole('link', { name: 'Habitualista' })).toHaveCount(0)
  await gestora.page.goto('/habitualista')
  await expect(gestora.page.getByText(/cobrad|cobro|\$ 3\.000\.000|\$ 4\.350\.000/i)).toHaveCount(0)
  expect(gestora.mock.rutasPedidas.filter((r) => /cobros|v_saldos|movimientos/.test(r))).toEqual([])
})
