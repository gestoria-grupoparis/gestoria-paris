// Nada se sale de su tarjeta: cliente de 80 caracteres y saldo enorme negativo, de 320 a 1440 px.
import { expect, test, type Page } from '@playwright/test'
import { montarSupabase } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const GABRIELA = '00000000-0000-4000-8000-000000000071'
const LARGO = 'María de los Ángeles Fernández Etcheverrigaray Montenegro de la Santísima Trinidad'.slice(0, 80)
const ENORME = '-99999999999999'

const semilla = [
  { operacion: { ...f.operacion, cliente_nombre: LARGO }, tramite: { ...f.autorizado, vehiculo_desc: 'Volkswagen Amarok V6 Extreme Highline Black Edition 4x4 Automática' }, presupuestos: ['70000000'], aprobado: true, marcas: ['retirado'] },
  { operacion: { ...f.operacion, cliente_nombre: LARGO }, tramite: f.presentado, presupuestos: ['70000000'] },
]
const saldosFijos = () =>
  catalogos.cuentas.map((c) => ({
    cuenta_id: c.id, empresa_id: c.empresa_id, empresa: catalogos.empresas.find((e) => e.id === c.empresa_id)!.nombre,
    registrado: ENORME, comprometido: '99999999999999', disponible: ENORME, ultima_conciliacion_fecha: null, ultima_diferencia: null,
  }))

async function sinDesborde(page: Page, ruta: string) {
  const medida = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth - window.innerWidth,
    montos: [...document.querySelectorAll<HTMLElement>('[data-testid=disponible]')].filter((el) => el.scrollWidth > el.clientWidth + 1).length,
  }))
  expect(medida, ruta).toEqual({ pagina: 0, montos: 0 })
}

const RUTAS: { usuario?: string; rutas: string[] }[] = [
  { rutas: ['/tablero', '/tramites', '/habitualista', '/analisis'] },
  { usuario: GABRIELA, rutas: ['/mis-tramites'] },
]

for (const ancho of [320, 375, 768, 1024, 1440])
  test(`sin desbordes a ${ancho}px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 })
    await page.clock.setFixedTime(catalogos.ahora)
    for (const { usuario, rutas } of RUTAS) {
      await montarSupabase(page, semilla, { usuario, saldosFijos })
      for (const ruta of rutas) {
        await page.goto(ruta)
        await expect(page.getByRole('main')).toBeVisible()
        await page.waitForLoadState('networkidle')
        await sinDesborde(page, ruta)
      }
    }
  })

test('a 375 px los trámites se ven como tarjetas con número y estado', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.clock.setFixedTime(catalogos.ahora)
  await montarSupabase(page, semilla, { saldosFijos })
  await page.goto('/tramites')
  const tarjetas = page.getByRole('list', { name: 'Trámites' }).getByRole('listitem')
  await expect(tarjetas.first()).toContainText(/T-2026-000\d\d/)
  await expect(tarjetas.filter({ hasText: 'T-2026-00012' })).toContainText('Presentado')
  await expect(page.getByRole('table')).toBeHidden()
  await sinDesborde(page, '/tramites')
})
