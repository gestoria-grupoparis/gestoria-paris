// Circuito completo empresa - gestora con dos navegadores sobre el mismo "servidor": la contable
// autoriza y asigna, la gestora presupuesta, la contable aprueba, la gestora retira el legajo,
// presenta, finaliza y devuelve, y la contable cierra.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import f from './fixtures/tramites-gestora.json' with { type: 'json' }

const CARLA = '00000000-0000-4000-8000-0000000000c1'
const GABRIELA = '00000000-0000-4000-8000-000000000071'
const ID = f.autorizado.id

async function abrir(browser: Browser, servidor: Servidor, usuario: string, movil = false) {
  const ctx = await browser.newContext(movil ? { viewport: { width: 375, height: 812 } } : { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor })
  return { page, mock }
}

const tarjeta = (page: Page, grupo: string) =>
  page.getByRole('region', { name: grupo }).getByRole('article', { name: /T-2026-00011/ })

test('ping pong: presupuesto, aprobación, retiro, presentación, finalizado, devuelto y cierre', async ({ browser }) => {
  const perfilCarla = catalogos.perfiles.find((p) => p.id === CARLA)
  expect(perfilCarla?.rol).toBe('contable')
  const servidor = crearServidor([{ operacion: f.operacion, tramite: { ...f.autorizado, estado: 'borrador', gestora_id: null, version: 1 } }])
  const empresa = await abrir(browser, servidor, CARLA)
  const gestora = await abrir(browser, servidor, GABRIELA, true)

  // 1. La empresa revisa y autoriza asignando a la gestora.
  await empresa.page.goto(`/tramites?t=${ID}`)
  const detalle = empresa.page.getByRole('complementary', { name: 'Detalle del trámite' })
  await detalle.getByRole('button', { name: 'Autorizar' }).click()
  const autorizar = empresa.page.getByRole('dialog', { name: 'Autorizar trámite' })
  await autorizar.getByLabel('Gestora').selectOption({ label: 'Gabriela Gestora' })
  await autorizar.getByRole('button', { name: 'Confirmar autorización' }).click()
  await expect(autorizar).toBeHidden()

  // 2. La gestora lo ve para presupuestar y carga 700.000 (dos sellados de 50.000 incluidos en otros).
  await gestora.page.goto('/mis-tramites')
  await tarjeta(gestora.page, 'Presupuestar').getByRole('button', { name: 'Cargar presupuesto' }).click()
  const form = gestora.page.getByRole('dialog', { name: 'Cargar presupuesto' })
  await form.getByLabel('Arancel').fill('600.000')
  await form.getByLabel('Sellados').fill('100.000')
  await form.getByRole('button', { name: 'Guardar presupuesto' }).click()
  await expect(form).toBeHidden()
  const espera = tarjeta(gestora.page, 'Esperando aprobación')
  await expect(espera.getByTestId('presupuesto')).toHaveText('$ 700.000,00')

  // 3. La empresa lo encuentra en "Presupuestos para aprobar" y lo aprueba.
  await empresa.page.goto('/tramites?vista=para_aprobar')
  await expect(empresa.page.getByText('T-2026-00011').first()).toBeVisible()
  await empresa.page.goto(`/tramites?t=${ID}`)
  await expect(detalle).toContainText('La gestora presupuestó $ 700.000,00')
  await detalle.getByRole('button', { name: 'Aprobar presupuesto' }).click()
  const aprobar = empresa.page.getByRole('dialog', { name: 'Aprobar presupuesto' })
  await aprobar.getByRole('button', { name: 'Confirmar aprobación' }).click()
  await expect(aprobar).toBeHidden()
  await expect(detalle.getByRole('button', { name: 'Aprobar presupuesto' })).toHaveCount(0)
  await empresa.page.goto('/tramites?vista=para_aprobar')
  await expect(empresa.page.getByText('T-2026-00011')).toHaveCount(0)

  // 4. La gestora retira el legajo, presenta, marca finalizado y devuelto.
  await gestora.page.goto('/mis-tramites')
  const lista = tarjeta(gestora.page, 'Retirar y presentar')
  await expect(lista.getByRole('button', { name: 'Marcar presentado' })).toHaveCount(0)
  await lista.getByRole('button', { name: 'Retiré el legajo' }).click()
  await lista.getByRole('button', { name: 'Marcar presentado' }).click()
  await tarjeta(gestora.page, 'Presentados').getByRole('button', { name: 'Marcar finalizado' }).click()
  await tarjeta(gestora.page, 'Para devolver').getByRole('button', { name: 'Marcar devuelto' }).click()
  await expect(gestora.page.getByRole('heading', { name: 'Estás al día' })).toBeVisible()

  // 5. La empresa ve el trámite devuelto y lo cierra.
  await empresa.page.goto(`/tramites?t=${ID}`)
  await expect(detalle.getByTestId('estado')).toHaveText('Devuelto')
  expect(servidor.st.marcas.map((m) => m.marca)).toEqual(['retirado'])
  await detalle.getByRole('button', { name: 'Cerrar trámite' }).click()
  const cerrar = empresa.page.getByRole('dialog', { name: 'Cerrar trámite' })
  await cerrar.getByRole('button', { name: 'Confirmar' }).click()
  await expect(cerrar).toBeHidden()
  await expect(detalle.getByTestId('estado')).toHaveText('Cerrado')
  expect(servidor.st.tramites[0].estado).toBe('cerrado')
})

test('la gestora no puede retirar ni presentar sin aprobación (la base lo rechaza aunque fuerce el pedido)', async ({ browser }) => {
  const servidor = crearServidor([{ operacion: f.operacion, tramite: f.autorizado, presupuestos: ['70000000'] }])
  const gestora = await abrir(browser, servidor, GABRIELA, true)
  await gestora.page.goto('/mis-tramites')
  await expect(tarjeta(gestora.page, 'Esperando aprobación')).toBeVisible()
  const r = await gestora.page.evaluate(async (id) => {
    const url = 'http://supabase.e2e.test/rest/v1/rpc/cambiar_estado'
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_tramite: id, p_estado: 'presentado', p_motivo: '', p_version: 2 }) })
    return (await res.json()).message as string
  }, ID)
  expect(r).toMatch(/^NO_AUTORIZADO:/)
})

test('filtros de la gestora: por razón social y por etapa', async ({ browser }) => {
  const otraOp = { ...f.operacion, id: '00000000-0000-4000-8000-000000000093', empresa_id: catalogos.empresas[1].id, oferta_ref: 'OF-9' }
  const otro = { ...f.presentado, operacion_id: otraOp.id, empresa_id: catalogos.empresas[1].id }
  const servidor = crearServidor([
    { operacion: f.operacion, tramite: f.autorizado },
    { operacion: otraOp, tramite: otro, presupuestos: ['50000000'], aprobado: true },
  ])
  const { page } = await abrir(browser, servidor, GABRIELA, true)
  await page.goto('/mis-tramites')
  await expect(page.getByRole('article', { name: /T-2026-00011/ })).toBeVisible()
  await expect(page.getByRole('article', { name: /T-2026-00012/ })).toBeVisible()

  // Por razón social.
  const razon = page.getByRole('group', { name: 'Razón social' })
  await razon.getByRole('button', { name: catalogos.empresas[1].nombre }).click()
  await expect(page.getByRole('article', { name: /T-2026-00011/ })).toHaveCount(0)
  await expect(page.getByRole('article', { name: /T-2026-00012/ })).toBeVisible()
  await razon.getByRole('button', { name: 'Todas' }).click()

  // Por etapa (resumen).
  const resumen = page.getByRole('navigation', { name: 'Resumen' })
  await resumen.getByRole('button', { name: /Presupuestar/ }).click()
  await expect(page.getByRole('article', { name: /T-2026-00012/ })).toHaveCount(0)
  await expect(page.getByRole('article', { name: /T-2026-00011/ })).toBeVisible()
  await resumen.getByRole('button', { name: /Presupuestar/ }).click()
  await expect(page.getByRole('article', { name: /T-2026-00012/ })).toBeVisible()
})

test('autorizar sin gestoras activas explica qué hacer', async ({ browser }) => {
  const servidor = crearServidor([{ operacion: f.operacion, tramite: { ...f.autorizado, estado: 'borrador', gestora_id: null, version: 1 } }])
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const mock = await montarSupabase(page, [], { usuario: CARLA, servidor })
  for (const p of mock.perfiles) if (p.rol === 'gestora') p.activo = false
  await page.goto(`/tramites?t=${ID}`)
  await page.getByRole('complementary', { name: 'Detalle del trámite' }).getByRole('button', { name: 'Autorizar' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Autorizar trámite' })
  await expect(dialogo.getByRole('alert')).toContainText('Todavía no hay gestoras activas')
  await expect(dialogo.getByRole('button', { name: 'Confirmar autorización' })).toBeDisabled()
})
