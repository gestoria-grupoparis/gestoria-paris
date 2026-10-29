import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const CONTABLE = '00000000-0000-4000-8000-0000000000c1'

test('si una pantalla falla al dibujar, se ve el aviso y el menú sigue navegando', async ({ page }) => {
  await montarSupabase(page, [], {
    saldosFijos: () => [{ empresa_id: 'x', empresa_nombre: 'Rota', disponible: 'no-es-plata', saldo_contable: 'x', comprometido: 'x' }],
  })
  await page.goto('/tablero')
  await expect(page.getByText('Algo salió mal en esta pantalla')).toBeVisible()
  await page.getByRole('navigation').first().getByRole('link', { name: 'Trámites' }).click()
  await expect(page).toHaveURL(/\/tramites/)
  await expect(page.getByText('Algo salió mal en esta pantalla')).toHaveCount(0)
})

test('un error de permisos no se reintenta', async ({ page }) => {
  await montarSupabase(page)
  let llamadas = 0
  await page.route('**/rest/v1/v_saldos*', (route) => {
    llamadas++
    return route.fulfill({ status: 400, json: { code: 'P0001', message: 'SIN_PERMISO: sin alcance', details: null, hint: null } })
  })
  await page.goto('/tablero')
  await expect.poll(() => llamadas).toBeGreaterThan(0)
  await page.waitForTimeout(3500)
  expect(llamadas).toBe(1)
})

test('doble clic rápido en "Guardar carga" y "Confirmar aprobación" llama una sola vez', async ({ page }) => {
  const contar = (rpc: string) => {
    let n = 0
    page.on('request', (r) => r.url().includes(`/rpc/${rpc}`) && r.method() === 'POST' && n++)
    return () => n
  }
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [{ operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'] }], { usuario: CONTABLE })
  const cargas = contar('registrar_carga')
  const aprobaciones = contar('aprobar_presupuesto')

  await page.goto('/habitualista')
  await page.getByRole('button', { name: 'Registrar carga' }).click()
  const form = page.getByRole('dialog', { name: 'Registrar carga' })
  await form.getByLabel('Importe').fill('5.000.000')
  await form.getByLabel('Fecha de la carga').fill('2026-10-28')
  await form.getByRole('button', { name: 'Guardar carga' }).dblclick()
  await expect(form).toBeHidden()
  expect(cargas()).toBe(1)

  await page.goto(`/tramites?t=${f.autorizado.id}`)
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await detalle.getByRole('button', { name: 'Aprobar presupuesto' }).click()
  const aprobar = page.getByRole('dialog', { name: 'Aprobar presupuesto' })
  await aprobar.getByRole('button', { name: 'Confirmar aprobación' }).dblclick()
  await expect(aprobar).toBeHidden()
  expect(aprobaciones()).toBe(1)
})
