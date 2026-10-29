import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'

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
