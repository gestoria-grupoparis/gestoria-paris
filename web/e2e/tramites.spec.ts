import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase } from './mock-supabase'
import borrador from './fixtures/tramite-borrador.json' with { type: 'json' }

async function completarAlta(page: Page) {
  const form = page.getByRole('dialog', { name: 'Nuevo trámite' })
  await form.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await form.getByLabel('Sucursal').selectOption({ label: 'Casa central (San Luis)' })
  await form.getByLabel('Tipo').selectOption({ label: 'Patentamiento 0 km' })
  await form.getByLabel('Cliente').fill('María Gómez')
  await form.getByLabel('Cuenta personal').fill('CP-7788')
  await form.getByLabel('Oferta').fill('OF-5521')
  await form.getByLabel('Vehículo').fill('Peugeot 208 Allure')
  await form.getByLabel('Dominio').fill('ab123cd')
  return form
}

test('contable da de alta, ve el aviso de duplicado al repetir, autoriza asignando gestora y lo encuentra buscando por dominio', async ({ page }) => {
  await montarSupabase(page)
  await page.goto('/tramites')

  await page.getByRole('button', { name: 'Nuevo trámite' }).click()
  let form = await completarAlta(page)
  await form.getByRole('button', { name: 'Guardar trámite' }).click()
  await expect(form).toBeHidden()

  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(detalle.getByRole('heading', { name: 'T-2026-00001' })).toBeVisible()
  await expect(detalle.getByTestId('estado')).toHaveText('Borrador')

  await page.getByRole('button', { name: 'Nuevo trámite' }).click()
  form = await completarAlta(page)
  await form.getByRole('button', { name: 'Guardar trámite' }).click()
  await expect(form.getByRole('alert')).toContainText('Posible duplicado')
  await expect(form.getByRole('alert')).toContainText('T-2026-00001')
  await form.getByRole('button', { name: 'Cancelar' }).click()
  await expect(form).toBeHidden()

  await detalle.getByRole('button', { name: 'Autorizar' }).click()
  const autorizar = page.getByRole('dialog', { name: 'Autorizar trámite' })
  await autorizar.getByLabel('Gestora').selectOption({ label: 'Gabriela Gestora' })
  await autorizar.getByRole('button', { name: 'Confirmar autorización' }).click()
  await expect(autorizar).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Autorizado')
  await expect(detalle.getByTestId('gestora')).toHaveText('Gabriela Gestora')

  await detalle.getByRole('button', { name: 'Cerrar detalle' }).click()
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('AB123CD')
  await expect(page).toHaveURL(/q=AB123CD/)
  const filas = page.getByRole('table', { name: 'Trámites' }).getByRole('row')
  await expect(filas).toHaveCount(2) // encabezado + 1
  await expect(filas.nth(1)).toContainText('T-2026-00001')
  await expect(filas.nth(1)).toContainText('AB123CD')
  await expect(filas.nth(1)).toContainText('Autorizado')
  await expect(filas.nth(1)).toContainText('Gabriela Gestora')

  await page.reload()
  await expect(page.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('AB123CD')
  await expect(page.getByRole('table', { name: 'Trámites' }).getByRole('row')).toHaveCount(2)
})

test('observar exige motivo y el historial muestra autor y fecha', async ({ page }) => {
  await montarSupabase(page, [borrador])
  await page.goto('/tramites')

  await page.getByRole('row', { name: /T-2026-00001/ }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await expect(page).toHaveURL(/t=00000000-0000-4000-8000-0000000000a1/)

  await detalle.getByRole('button', { name: 'Observar' }).click()
  const observar = page.getByRole('dialog', { name: 'Observar trámite' })
  await observar.getByRole('button', { name: 'Confirmar observación' }).click()
  await expect(observar.getByRole('alert')).toHaveText('Indicá el motivo de la observación.')
  await expect(detalle.getByTestId('estado')).toHaveText('Borrador')

  await observar.getByLabel('Motivo').fill('Falta la firma del titular')
  await observar.getByRole('button', { name: 'Confirmar observación' }).click()
  await expect(observar).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Observado')

  const historial = detalle.getByRole('list', { name: 'Historial' })
  const ultimo = historial.getByRole('listitem').first()
  await expect(ultimo).toContainText('Borrador → Observado')
  await expect(ultimo).toContainText('Falta la firma del titular')
  await expect(ultimo).toContainText('Carla Contable')
  await expect(ultimo).toContainText('28/10/2026 10:45')
})

test('suspender y reanudar vuelve al estado previo; marcas documentales y cancelación con motivo', async ({ page }) => {
  await montarSupabase(page, [borrador])
  await page.goto('/tramites')
  await page.getByRole('row', { name: /T-2026-00001/ }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })

  await detalle.getByRole('button', { name: 'Marcar legajo recibido' }).click()
  const marcas = detalle.getByRole('list', { name: 'Marcas documentales' })
  await expect(marcas.getByRole('listitem').first()).toContainText('Carla Contable')
  await expect(detalle.getByRole('button', { name: 'Marcar legajo recibido' })).toHaveCount(0)

  await detalle.getByRole('button', { name: 'Suspender' }).click()
  const suspender = page.getByRole('dialog', { name: 'Suspender trámite' })
  await suspender.getByRole('button', { name: 'Confirmar suspensión' }).click()
  await expect(suspender.getByRole('alert')).toHaveText('Indicá el motivo de la suspensión.')
  await suspender.getByLabel('Motivo').fill('Cliente de viaje')
  await suspender.getByRole('button', { name: 'Confirmar suspensión' }).click()
  await expect(detalle.getByTestId('estado')).toHaveText('Suspendido')

  await detalle.getByRole('button', { name: 'Reanudar' }).click()
  const reanudar = page.getByRole('dialog', { name: 'Reanudar trámite' })
  await expect(reanudar).toContainText('Vuelve a Borrador.')
  await reanudar.getByLabel('Motivo').fill('Volvió')
  await reanudar.getByRole('button', { name: 'Confirmar' }).click()
  await expect(detalle.getByTestId('estado')).toHaveText('Borrador')

  await detalle.getByRole('button', { name: 'Cancelar trámite' }).click()
  const cancelar = page.getByRole('dialog', { name: 'Cancelar trámite' })
  await cancelar.getByLabel('Motivo').fill('Se cayó la venta')
  await cancelar.getByRole('button', { name: 'Confirmar cancelación' }).click()
  await expect(detalle.getByTestId('estado')).toHaveText('Cancelado')
  await expect(detalle.getByRole('button', { name: 'Cancelar trámite' })).toHaveCount(0)
  await expect(detalle.getByRole('list', { name: 'Historial' }).getByRole('listitem').first()).toContainText('Se cayó la venta')
})

test('el diálogo conserva el foco y lo escrito aunque lleguen cambios en vivo; Escape no cierra durante el envío', async ({ page }) => {
  const servidor = crearServidor([borrador])
  await montarSupabase(page, [], { servidor })
  await page.goto('/tramites')
  await page.getByRole('row', { name: /T-2026-00001/ }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await detalle.getByRole('button', { name: 'Suspender' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Suspender trámite' })
  const motivo = dialogo.getByLabel('Motivo')
  await motivo.pressSequentially('Cliente ')
  const refetch = page.waitForRequest((r) => r.url().includes('/rest/v1/tramites'))
  servidor.notificar('tramites')
  await refetch
  await page.keyboard.type('de viaje')
  await expect(motivo).toHaveValue('Cliente de viaje')

  let soltar = () => {}
  const espera = new Promise<void>((r) => (soltar = r))
  await page.route('**/rest/v1/rpc/cambiar_estado', async (route) => {
    await espera
    await route.fallback()
  })
  await dialogo.getByRole('button', { name: 'Confirmar suspensión' }).click()
  await page.keyboard.press('Escape')
  await expect(dialogo).toBeVisible()
  soltar()
  await expect(dialogo).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Suspendido')
})
