import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import h from './fixtures/habitualista.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'

function servidorHabitualista(): Servidor {
  return crearServidor(
    [
      { operacion: h.operacion, tramite: h.tramite21, presupuestos: ['70000000'] },
      { operacion: h.operacion, tramite: h.tramite22, presupuestos: ['50000000'] },
    ],
    { movimientos: h.movimientos, conciliaciones: h.conciliaciones },
  )
}

async function abrir(page: Page, servidor: Servidor, usuario: string) {
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [], { usuario, servidor })
  await page.goto('/habitualista')
  await expect(page.getByRole('heading', { name: 'Habitualista' })).toBeVisible()
}

const tarjeta = (page: Page, nombre: string) => page.getByRole('region', { name: nombre })
const filaDe = (page: Page, texto: RegExp | string) =>
  page.getByRole('table', { name: 'Movimientos' }).getByRole('row').filter({ hasText: texto })

test('contable registra carga y las tarjetas se actualizan; el movimiento aparece no conciliado', async ({ page }) => {
  await abrir(page, servidorHabitualista(), CONTABLE)
  await expect(page.getByLabel('Razón social')).toHaveValue('00000000-0000-4000-8000-0000000000e1')
  await expect(tarjeta(page, 'Saldo registrado').getByTestId('importe')).toHaveText('$ 1.250.000,00')
  await expect(tarjeta(page, 'Comprometido').getByTestId('importe')).toHaveText('$ 450.000,00')
  await expect(tarjeta(page, 'Disponible proyectado').getByTestId('importe')).toHaveText('$ 800.000,00')
  await expect(tarjeta(page, 'Última conciliación')).toContainText('25/10/2026')
  await expect(page.getByRole('button', { name: 'Ajuste' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Registrar carga' }).click()
  const form = page.getByRole('dialog', { name: 'Registrar carga' })
  await form.getByLabel('Importe').fill('500.000')
  await form.getByLabel('Fecha de la carga').fill('2026-10-28')
  await form.getByRole('button', { name: 'Guardar carga' }).click()
  await expect(form).toBeHidden()

  await expect(tarjeta(page, 'Saldo registrado').getByTestId('importe')).toHaveText('$ 1.750.000,00')
  await expect(tarjeta(page, 'Comprometido').getByTestId('importe')).toHaveText('$ 450.000,00')
  await expect(tarjeta(page, 'Disponible proyectado').getByTestId('importe')).toHaveText('$ 1.300.000,00')

  const fila = filaDe(page, '28/10/2026').filter({ hasText: 'Carga' })
  await expect(fila).toHaveCount(1)
  await expect(fila.getByTestId('ingreso')).toHaveText('$ 500.000,00')
  await expect(fila.getByTestId('saldo')).toHaveText('$ 1.750.000,00')
  await expect(fila.getByTestId('conciliado')).toHaveText('Pendiente')
  await expect(filaDe(page, '01/10/2026').getByTestId('conciliado')).toHaveText('✓')
})

test('revertir un pago pide motivo y muestra ambas filas ligadas', async ({ page }) => {
  await abrir(page, servidorHabitualista(), CONTABLE)
  const pago = filaDe(page, 'T-2026-00021')
  await pago.getByRole('button', { name: 'Revertir' }).click()
  const form = page.getByRole('dialog', { name: 'Revertir movimiento' })
  await form.getByRole('button', { name: 'Confirmar reversión' }).click()
  await expect(form.getByRole('alert')).toHaveText('Ingresá el motivo de la reversión.')
  await form.getByLabel('Motivo').fill('Pago cargado dos veces')
  await form.getByRole('button', { name: 'Confirmar reversión' }).click()
  await expect(form).toBeHidden()

  const original = filaDe(page, 'T-2026-00021').filter({ hasNotText: 'Reversión' })
  const reversion = filaDe(page, 'T-2026-00021').filter({ hasText: 'Reversión' })
  await expect(original.getByTestId('vinculo')).toHaveText('Revertido el 28/10/2026')
  await expect(original.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await expect(reversion.getByTestId('vinculo')).toHaveText('Revierte el pago del 10/10/2026')
  await expect(reversion.getByTestId('ingreso')).toHaveText('$ 450.000,00')
  await expect(tarjeta(page, 'Comprometido').getByTestId('importe')).toHaveText('$ 900.000,00')
  await expect(tarjeta(page, 'Disponible proyectado').getByTestId('importe')).toHaveText('$ 800.000,00')
})

test('dos navegadores (contable y gerencia) ven el comprometido del otro sin recargar', async ({ browser }) => {
  const servidor = servidorHabitualista()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const contable = await ctxA.newPage()
  const gerencia = await ctxB.newPage()
  await abrir(contable, servidor, CONTABLE)
  await abrir(gerencia, servidor, GERENTE)
  await expect(gerencia.getByRole('button', { name: 'Ajuste' })).toBeVisible()
  await expect(tarjeta(gerencia, 'Comprometido').getByTestId('importe')).toHaveText('$ 450.000,00')

  async function revertir(page: Page, numero: string) {
    await filaDe(page, numero).getByRole('button', { name: 'Revertir' }).click()
    const form = page.getByRole('dialog', { name: 'Revertir movimiento' })
    await form.getByLabel('Motivo').fill('Error de carga')
    await form.getByRole('button', { name: 'Confirmar reversión' }).click()
    await expect(form).toBeHidden()
  }

  await revertir(contable, 'T-2026-00021')
  await expect(tarjeta(gerencia, 'Comprometido').getByTestId('importe')).toHaveText('$ 900.000,00')
  await revertir(gerencia, 'T-2026-00022')
  await expect(tarjeta(contable, 'Comprometido').getByTestId('importe')).toHaveText('$ 1.200.000,00')
  await ctxA.close()
  await ctxB.close()
})

test('tablero muestra saldos por razón social, contadores y trámites que requieren intervención', async ({ page }) => {
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [], { usuario: GERENTE, servidor: servidorHabitualista() })
  await page.goto('/tablero')
  const autos = page.getByRole('row', { name: /Paris Autos/ })
  await expect(autos.getByTestId('disponible')).toHaveText('$ 800.000,00')
  await expect(autos.getByTestId('recarga')).toHaveText('$ 0,00')
  await expect(page.getByRole('list', { name: 'Requieren intervención' })).toContainText('T-2026-00022')
  await expect(page.getByRole('list', { name: 'Requieren intervención' })).not.toContainText('T-2026-00021')
  await page.getByRole('link', { name: /Presentado 1/ }).click()
  await expect(page).toHaveURL(/\/tramites\?estado=presentado$/)
})
