// Escenario integral (spec K / sección 14 del prompt; mismos importes y alcances que
// tests/db/escenario-integral.test.ts): contable de San Luis y gerencia de San Juan (alcance por
// sucursal) dan de alta trámites de Paris Autos; la gestora presupuesta y paga; una gerencia con
// alcance sobre toda la razón social carga fondos y lee los saldos (v_saldos exige ese alcance).
// v_saldos se sirve desde fixtures/escenario-saldos.json, que es la salida de PostgreSQL verificada
// por el test de DB: el mock no calcula ningún saldo de este escenario.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Estado, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import saldosDb from './fixtures/escenario-saldos.json' with { type: 'json' }

const CONTABLE_SAN_LUIS = '00000000-0000-4000-8000-0000000000c1'
const GERENCIA_SAN_JUAN = '00000000-0000-4000-8000-0000000000a2'
const GERENCIA_GENERAL = '00000000-0000-4000-8000-0000000000a1'
const GESTORA = '00000000-0000-4000-8000-000000000071'

const PARIS_AUTOS = catalogos.empresas.find((e) => e.nombre === 'Paris Autos')!.id
const PARIS_CARS = catalogos.empresas.find((e) => e.nombre === 'Paris Cars')!.id
const SAN_LUIS = catalogos.sucursales.find((x) => x.provincia === 'San Luis')!.id
const SAN_JUAN = catalogos.sucursales.find((x) => x.provincia === 'San Juan')!.id
const CUENTA_PA = catalogos.cuentas.find((c) => c.empresa_id === PARIS_AUTOS)!

function saldosFijos(st: Estado) {
  const tramitesPA = new Set(st.tramites.filter((t) => t.empresa_id === PARIS_AUTOS).map((t) => t.id))
  const movsPA = st.movimientos.filter((m) => m.cuenta_id === CUENTA_PA.id)
  const firma =
    `cargas=${movsPA.filter((m) => m.tipo === 'carga').length},` +
    `presupuestos=${st.presupuestos.filter((p) => tramitesPA.has(p.tramite_id)).length},` +
    `pagos=${movsPA.filter((m) => m.tipo === 'pago_tramite').length}`
  const p = saldosDb.pasos.find((x) => x.firma === firma)
  if (!p) return undefined
  return [{
    cuenta_id: CUENTA_PA.id, empresa_id: PARIS_AUTOS, empresa: 'Paris Autos',
    registrado: p.registrado_cents, comprometido: p.comprometido_cents, disponible: p.disponible_cents,
    ultima_conciliacion_fecha: null, ultima_diferencia: null,
    // En todos los pasos el disponible es >= 0: la base da recarga 0 y ningún trámite sin fondos.
    recarga: '0', tramites_sin_fondos: 0,
  }]
}

type Alcance = { empresa_id: string; sucursal_id: string | null }

async function abrirComo(browser: Browser, servidor: Servidor, usuario: string, alcances: Alcance[], movil = false) {
  const ctx = await browser.newContext(movil ? { viewport: { width: 375, height: 812 } } : {})
  const page = await ctx.newPage()
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor, alcances, saldosFijos })
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

async function completarAlta(page: Page, sucursal: string, oferta: string, dominio: string) {
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
  return form
}

async function altaYAutorizacion(page: Page, sucursal: string, oferta: string, dominio: string, numero: string) {
  const form = await completarAlta(page, sucursal, oferta, dominio)
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

// La empresa aprueba el presupuesto desde el panel del trámite (ping pong con la gestora).
async function aprobarPresupuesto(page: Page, id: string, numero: string) {
  await page.goto(`/tramites?t=${id}`)
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(detalle.getByRole('heading', { name: numero })).toBeVisible()
  await detalle.getByRole('button', { name: 'Aprobar presupuesto' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Aprobar presupuesto' })
  await dialogo.getByRole('button', { name: 'Confirmar aprobación' }).click()
  await expect(dialogo).toBeHidden()
  await expect(detalle.getByRole('button', { name: 'Aprobar presupuesto' })).toHaveCount(0)
}

// Importe cobrado al cliente (Etapa 2): ninguna pantalla de la gestora puede mostrarlo ni pedirlo.
const COBRO_CLIENTE = '123456700'
const COBRO_EN_PANTALLA = /1\.234\.567|1234567/

async function sinCobro(page: Page, mock: { urlsPedidas: string[] }) {
  await expect(page.locator('body')).not.toContainText(COBRO_EN_PANTALLA)
  expect(mock.urlsPedidas.filter((u) => /importe_cliente|cobr/i.test(u))).toEqual([])
}

test('escenario integral: tres usuarios y los cuatro tríos de saldos de Paris Autos', async ({ browser }) => {
  const servidor = crearServidor()
  const general = await abrirComo(browser, servidor, GERENCIA_GENERAL, [{ empresa_id: PARIS_AUTOS, sucursal_id: null }])
  const contable = await abrirComo(browser, servidor, CONTABLE_SAN_LUIS, [{ empresa_id: PARIS_AUTOS, sucursal_id: SAN_LUIS }])
  const gerencia = await abrirComo(browser, servidor, GERENCIA_SAN_JUAN, [{ empresa_id: PARIS_AUTOS, sucursal_id: SAN_JUAN }])
  const gestora = await abrirComo(browser, servidor, GESTORA, [], true)

  // 0. Alcances: la gerencia de San Juan no puede dar de alta en San Luis, y ni ella ni la contable
  // de San Luis ven el saldo de la cuenta compartida (v_saldos exige alcance sobre toda la empresa).
  const ajeno = await completarAlta(gerencia.page, 'Casa central (San Luis)', 'OF-X', 'ZZ999ZZ')
  await expect(ajeno.getByRole('alert')).toHaveText('Sin alcance sobre esa razón social y sucursal.')
  expect(servidor.st.tramites).toEqual([])
  for (const u of [contable, gerencia]) {
    await u.page.goto('/habitualista')
    await expect(u.page.getByText('No tenés alcance sobre ninguna razón social completa.')).toBeVisible()
  }
  await verSaldos(general.page, '$ 0,00', '$ 0,00', '$ 0,00')

  // 1. Carga de 3.000.000 y trámite de San Luis presupuestado en 700.000.
  await registrarCarga(general.page, '3.000.000')
  await altaYAutorizacion(contable.page, 'Casa central (San Luis)', 'OF-1', 'AA001AA', 'T-2026-00001')
  await cargarPresupuesto(gestora.page, 'T-2026-00001', '700.000')
  await verSaldos(general.page, '$ 3.000.000,00', '$ 700.000,00', '$ 2.300.000,00')

  // 2. Gerencia de San Juan suma un trámite presupuestado en 900.000.
  await altaYAutorizacion(gerencia.page, 'Rivadavia (San Juan)', 'OF-2', 'AA002AA', 'T-2026-00002')
  await cargarPresupuesto(gestora.page, 'T-2026-00002', '900.000')
  await verSaldos(general.page, '$ 3.000.000,00', '$ 1.600.000,00', '$ 1.400.000,00')
  // Cada perfil por sucursal ve solo los trámites de su sucursal.
  await contable.page.goto('/tramites')
  await expect(contable.page.getByText('T-2026-00001').first()).toBeVisible()
  await expect(contable.page.getByText('T-2026-00002')).toHaveCount(0)
  await gerencia.page.goto('/tramites')
  await expect(gerencia.page.getByText('T-2026-00002').first()).toBeVisible()
  await expect(gerencia.page.getByText('T-2026-00001')).toHaveCount(0)

  // 3. La contable aprueba el presupuesto; la gestora retira el legajo, presenta y registra el pago final de 650.000.
  await aprobarPresupuesto(contable.page, '00000000-0000-4000-8000-000000000001', 'T-2026-00001')
  await gestora.page.goto('/mis-tramites')
  const listo = gestora.page.getByRole('region', { name: 'Retirar y presentar' }).getByRole('article', { name: /T-2026-00001/ })
  await listo.getByRole('button', { name: 'Retiré el legajo' }).click()
  await listo.getByRole('button', { name: 'Marcar presentado' }).click()
  const presentado = gestora.page.getByRole('region', { name: 'Presentados' }).getByRole('article', { name: /T-2026-00001/ })
  await presentado.getByRole('button', { name: 'Registrar pago' }).click()
  const pago = gestora.page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(pago.getByLabel('¿Es el pago final?')).toBeChecked()
  await pago.getByLabel('Arancel').fill('650.000')
  await pago.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(pago).toBeHidden()
  await expect(presentado.getByTestId('situacion')).toHaveText('Pagado')
  await verSaldos(general.page, '$ 2.350.000,00', '$ 900.000,00', '$ 1.450.000,00')

  // 4. Nueva carga de 2.000.000.
  await registrarCarga(general.page, '2.000.000')
  await verSaldos(general.page, '$ 4.350.000,00', '$ 900.000,00', '$ 3.450.000,00')

  // 5. Trámites de la gestora (Paris Cars) cuyas filas traen el importe cobrado al cliente, como si
  // la base ya lo tuviera ($ 1.234.567,00): ninguna pantalla de la gestora lo muestra ni lo pide.
  const OP = '00000000-0000-4000-8000-00000000c0b0'
  servidor.st.operaciones.push({
    id: OP, empresa_id: PARIS_CARS, sucursal_id: SAN_LUIS, cliente_nombre: 'Cliente Peugeot', cuenta_personal: 'CP-C',
    oferta_ref: 'OF-C', referencia_mail: null, created_at: catalogos.ahora,
    importe_cliente_cents: COBRO_CLIENTE, cobrado_cents: COBRO_CLIENTE,
  })
  for (const [id, numero, estado] of [['c0b1', 'T-2026-00901', 'autorizado'], ['c0b2', 'T-2026-00902', 'presentado']]) {
    servidor.st.tramites.push({
      id: `00000000-0000-4000-8000-00000000${id}`, numero, operacion_id: OP, tipo_id: catalogos.tipos_tramite[0].id,
      empresa_id: PARIS_CARS, sucursal_id: SAN_LUIS, estado, vehiculo_desc: 'Peugeot 208', dominio: null, chasis: null,
      gestora_id: GESTORA, autorizado_at: catalogos.ahora, version: 2, created_at: catalogos.ahora,
      importe_cliente_cents: COBRO_CLIENTE, cobrado_cents: COBRO_CLIENTE,
    })
  }
  servidor.st.presupuestos.push({ tramite_id: '00000000-0000-4000-8000-00000000c0b2', version: 1, total: '50000000' })

  await gestora.page.goto('/mis-tramites')
  const aPresupuestar = gestora.page.getByRole('article', { name: /T-2026-00901/ })
  const aPagar = gestora.page.getByRole('article', { name: /T-2026-00902/ })
  await expect(aPresupuestar).toBeVisible()
  await expect(aPagar).toBeVisible()
  await sinCobro(gestora.page, gestora.mock)
  await aPresupuestar.getByRole('button', { name: 'Cargar presupuesto' }).click()
  await expect(gestora.page.getByRole('dialog', { name: 'Cargar presupuesto' })).toBeVisible()
  await sinCobro(gestora.page, gestora.mock)
  await gestora.page.keyboard.press('Escape')
  await aPagar.getByRole('button', { name: 'Registrar pago' }).click()
  await expect(gestora.page.getByRole('dialog', { name: 'Registrar pago' })).toBeVisible()
  await sinCobro(gestora.page, gestora.mock)
  await gestora.page.keyboard.press('Escape')
  await expect(gestora.page.getByText(/cobrad|cobro/i)).toHaveCount(0)
  await expect(gestora.page.getByRole('link', { name: 'Habitualista' })).toHaveCount(0)
  for (const ruta of ['/habitualista', '/tramites', '/tramites?t=00000000-0000-4000-8000-00000000c0b1', '/']) {
    await gestora.page.goto(ruta)
    await sinCobro(gestora.page, gestora.mock)
    await expect(gestora.page.getByText(/\$ 3\.000\.000|\$ 4\.350\.000/)).toHaveCount(0)
  }
  expect(gestora.mock.rutasPedidas.filter((r) => /cobros|v_saldos|movimientos/.test(r))).toEqual([])
})
