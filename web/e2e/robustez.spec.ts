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
