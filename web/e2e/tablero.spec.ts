import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

test('el tablero muestra los presupuestos por aprobar y el clic lleva a la lista filtrada', async ({ page }) => {
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, [
    { operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'] },
    { operacion: f.operacion, tramite: { ...f.autorizado, id: '00000000-0000-4000-8000-0000000000b9', numero: 'T-2026-00019', dominio: 'AF900ZZ' }, presupuestos: ['50000000'] },
    { operacion: f.operacion, tramite: f.presentado, presupuestos: ['70000000'] },
  ])
  await page.goto('/tablero')
  const kpi = page.getByRole('link', { name: /Por aprobar: 2 presupuestos/ })
  await expect(kpi).toBeVisible()
  await expect(page.getByTestId('etapa-presentados')).toHaveText('1')
  await expect(page.getByRole('table', { name: 'Por razón social' })).toContainText('Paris Cars')
  await expect(page.getByRole('list', { name: 'Requieren intervención' })).toContainText('Presupuesto por aprobar')
  await kpi.click()
  await expect(page).toHaveURL(/\/tramites\?por_aprobar=1/)
  await expect(page.getByRole('row', { name: /T-2026-000(11|19)/ })).toHaveCount(2)
  await expect(page.getByRole('row', { name: /T-2026-00012/ })).toHaveCount(0)
})
