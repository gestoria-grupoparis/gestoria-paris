import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Semilla } from './mock-supabase'
import borrador from './fixtures/tramite-borrador.json' with { type: 'json' }

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const SILVIA = '00000000-0000-4000-8000-000000000072'
const GABRIELA = '00000000-0000-4000-8000-000000000071'

/** Variante del borrador del fixture con otro id, número y estado. */
function semilla(n: number, cambios: Record<string, unknown> = {}, extra: Partial<Semilla> = {}): Semilla {
  const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
  return {
    operacion: borrador.operacion,
    tramite: {
      ...borrador.tramite, id, numero: `T-2026-001${String(n).padStart(2, '0')}`, dominio: `AE1${n}0AA`, ...cambios,
    },
    ...extra,
  }
}

async function abrir(page: Page, numero: string) {
  await page.getByRole('row', { name: new RegExp(numero) }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(detalle.getByRole('heading', { name: numero })).toBeVisible()
  return detalle
}

test('contable corrige los datos de un borrador y, en un observado, lo devuelve a borrador al guardar', async ({ page }) => {
  await montarSupabase(page, [borrador, semilla(2, { estado: 'observado', version: 2 })])
  await page.goto('/tramites')

  let detalle = await abrir(page, 'T-2026-00001')
  await detalle.getByRole('button', { name: 'Editar datos' }).click()
  let form = page.getByRole('dialog', { name: 'Editar datos del trámite' })
  await expect(form.getByLabel('Cliente')).toHaveValue('Juan Pérez')
  await form.getByLabel('Cliente').fill('Juan Manuel Pérez')
  await form.getByLabel('Dominio').fill('ae999zz')
  await form.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(form).toBeHidden()
  await expect(detalle).toContainText('Juan Manuel Pérez')
  await expect(detalle).toContainText('AE999ZZ')
  await expect(detalle.getByTestId('estado')).toHaveText('Borrador')

  await detalle.getByRole('button', { name: 'Cerrar detalle' }).click()
  detalle = await abrir(page, 'T-2026-00102')
  await detalle.getByRole('button', { name: 'Editar datos' }).click()
  form = page.getByRole('dialog', { name: 'Editar datos del trámite' })
  await expect(form.getByLabel('Volver a borrador al guardar')).toBeChecked()
  await form.getByLabel('Vehículo').fill('Toyota Hilux SRX 2026')
  await form.getByLabel('Motivo de la corrección').fill('Se corrigió el modelo')
  await form.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(form).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Borrador')
  await expect(detalle).toContainText('Toyota Hilux SRX 2026')
})

test('si otro usuario modificó el trámite, la edición avisa VERSION_CONFLICTO y no pisa nada', async ({ page }) => {
  const servidor = crearServidor([borrador])
  await montarSupabase(page, [], { servidor })
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00001')
  await detalle.getByRole('button', { name: 'Editar datos' }).click()
  const form = page.getByRole('dialog', { name: 'Editar datos del trámite' })
  servidor.st.tramites[0].version = 5
  await form.getByLabel('Cliente').fill('Otro nombre')
  await form.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(form.getByRole('alert')).toContainText('Otro usuario modificó este trámite')
  expect(servidor.st.operaciones[0].cliente_nombre).toBe('Juan Pérez')
})

test('contable carga presupuesto y pago desde el panel; la segunda versión pide motivo', async ({ page }) => {
  await montarSupabase(page, [semilla(3, { estado: 'autorizado', gestora_id: GABRIELA, version: 2 })])
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00103')

  await detalle.getByRole('button', { name: 'Cargar presupuesto' }).click()
  let dlg = page.getByRole('dialog', { name: 'Cargar presupuesto' })
  await dlg.getByLabel('Arancel').fill('150.000')
  await dlg.getByLabel('Sellados').fill('20.000,50')
  await dlg.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(dlg).toBeHidden()
  await expect(detalle.getByRole('table', { name: 'Versiones del presupuesto' })).toContainText('$ 170.000,50')

  await detalle.getByRole('button', { name: 'Nueva versión' }).click()
  dlg = page.getByRole('dialog', { name: 'Nueva versión del presupuesto' })
  await dlg.getByLabel('Arancel').fill('180.000')
  await dlg.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(dlg.getByRole('alert')).toContainText('Indicá el motivo del cambio')
  await dlg.getByLabel('Motivo del cambio').fill('Aumentó el arancel')
  await dlg.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(dlg).toBeHidden()
  await expect(detalle.getByRole('table', { name: 'Versiones del presupuesto' }).getByRole('row')).toHaveCount(3)

  await detalle.getByRole('button', { name: 'Registrar pago' }).click()
  dlg = page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(dlg.getByText('Pago de excepción')).toHaveCount(0)
  await dlg.getByLabel('Arancel').fill('180.000')
  await dlg.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(dlg).toBeHidden()
  await expect(detalle.getByRole('table', { name: 'Pagos del trámite' })).toContainText('Pago final')
  await expect(detalle.getByRole('table', { name: 'Pagos del trámite' })).toContainText('-$ 180.000,00')
})

test('un pago sobre un trámite no autorizado es una excepción R24 con motivo obligatorio', async ({ page }) => {
  await montarSupabase(page, [borrador])
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00001')

  await detalle.getByRole('button', { name: 'Registrar pago' }).click()
  const dlg = page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(dlg).toContainText('Pago de excepción')
  await dlg.getByLabel('Arancel').fill('50.000')
  await dlg.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(dlg.getByRole('alert')).toContainText('Indicá el motivo de la excepción')
  await dlg.getByLabel('Motivo de la excepción').fill('Se pagó antes de autorizar por urgencia del cliente')
  await dlg.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(dlg).toBeHidden()
  await expect(detalle.getByRole('table', { name: 'Pagos del trámite' })).toContainText('-$ 50.000,00')
})

test('gerencia aprueba la excepción de fondos de un trámite sin fondos', async ({ page }) => {
  await montarSupabase(
    page,
    [semilla(4, { estado: 'autorizado', gestora_id: GABRIELA, version: 2 }, { presupuestos: ['90000000'], situacion: 'sin_fondos' })],
    { usuario: GERENTE },
  )
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00104')
  await expect(detalle).toContainText('Sin fondos')

  await detalle.getByRole('button', { name: 'Aprobar excepción de fondos' }).click()
  const dlg = page.getByRole('dialog', { name: 'Aprobar excepción de fondos' })
  await dlg.getByRole('button', { name: 'Aprobar excepción' }).click()
  await expect(dlg.getByRole('alert')).toContainText('Indicá el motivo')
  await dlg.getByLabel('Motivo').fill('Cliente prioritario, se recarga el lunes')
  await dlg.getByRole('button', { name: 'Aprobar excepción' }).click()
  await expect(dlg).toBeHidden()
  await expect(detalle.getByRole('button', { name: 'Aprobar excepción de fondos' })).toHaveCount(0)
})

test('contable no ve la excepción de fondos', async ({ page }) => {
  await montarSupabase(page, [semilla(5, { estado: 'autorizado', gestora_id: GABRIELA, version: 2 }, { presupuestos: ['90000000'], situacion: 'sin_fondos' })])
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00105')
  await expect(detalle.getByRole('button', { name: 'Registrar pago' })).toBeVisible()
  await expect(detalle.getByRole('button', { name: 'Aprobar excepción de fondos' })).toHaveCount(0)
})

test('reintegro de un trámite cancelado con pagos (caso F)', async ({ page }) => {
  const t = semilla(6, { estado: 'cancelado', gestora_id: GABRIELA, version: 4 })
  await montarSupabase(page, [t], {
    servidor: crearServidor([t], {
      movimientos: [{
        id: '00000000-0000-4000-8000-0000000009a1', cuenta_id: '00000000-0000-4000-8000-0000000000c0', tipo: 'pago_tramite',
        importe: '-6000000', fecha_operacion: '2026-10-27', tramite_id: t.tramite.id, es_pago_final: true,
        created_at: '2026-10-27T15:00:00.000Z',
      }],
    }),
  })
  await page.goto('/tramites')
  const detalle = await abrir(page, 'T-2026-00106')

  await detalle.getByRole('button', { name: 'Registrar reintegro' }).click()
  const dlg = page.getByRole('dialog', { name: 'Registrar reintegro' })
  await dlg.getByLabel('Importe').fill('60.000')
  await dlg.getByRole('button', { name: 'Guardar reintegro' }).click()
  await expect(dlg.getByRole('alert')).toContainText('Indicá el motivo')
  await dlg.getByLabel('Motivo').fill('Devolución del registro por venta caída')
  await dlg.getByRole('button', { name: 'Guardar reintegro' }).click()
  await expect(dlg).toBeHidden()
  const pagos = detalle.getByRole('table', { name: 'Pagos del trámite' })
  await expect(pagos).toContainText('Reintegro')
  await expect(pagos).toContainText('$ 60.000,00')
})

test('reasigna varios trámites seleccionando filas (caso K)', async ({ page }) => {
  await montarSupabase(page, [
    semilla(7, { estado: 'autorizado', gestora_id: GABRIELA, version: 2 }),
    semilla(8, { estado: 'presentado', gestora_id: GABRIELA, version: 3 }),
    semilla(9, { estado: 'autorizado', gestora_id: GABRIELA, version: 2 }),
  ])
  await page.goto('/tramites')
  const tabla = page.getByRole('table', { name: 'Trámites' })
  await tabla.getByRole('checkbox', { name: 'Seleccionar T-2026-00107' }).check()
  await tabla.getByRole('checkbox', { name: 'Seleccionar T-2026-00108' }).check()
  const barra = page.getByRole('region', { name: 'Selección' })
  await expect(barra).toContainText('2 trámites seleccionados')

  await barra.getByRole('button', { name: 'Reasignar gestora' }).click()
  const dlg = page.getByRole('dialog', { name: 'Reasignar 2 trámites' })
  await dlg.getByLabel('Gestora').selectOption({ label: 'Silvia Gestora' })
  await dlg.getByRole('button', { name: 'Confirmar reasignación' }).click()
  await expect(dlg.getByRole('alert')).toContainText('Indicá el motivo de la reasignación.')
  await dlg.getByLabel('Motivo').fill('Gabriela de licencia')
  await dlg.getByRole('button', { name: 'Confirmar reasignación' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Se reasignaron 2 trámites a Silvia Gestora' })).toBeVisible()

  await expect(tabla.getByRole('row', { name: /T-2026-00107/ })).toContainText('Silvia Gestora')
  await expect(tabla.getByRole('row', { name: /T-2026-00108/ })).toContainText('Silvia Gestora')
  await expect(tabla.getByRole('row', { name: /T-2026-00109/ })).toContainText('Gabriela Gestora')
  await expect(barra).toBeHidden()
  void SILVIA
})
