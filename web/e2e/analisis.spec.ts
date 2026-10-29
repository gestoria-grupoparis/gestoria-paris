import { expect, test, type Page } from '@playwright/test'
import { crearServidor, montarSupabase, type Semilla } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }
import paginasValuaciones from '../src/features/analisis/__fixtures__/valuaciones-disp-160-2026.json' with { type: 'json' }

const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const GESTORA = '00000000-0000-4000-8000-000000000071'
const PARIS_AUTOS = '00000000-0000-4000-8000-0000000000e1'
const SUCURSAL = '00000000-0000-4000-8000-0000000000d1' // San Luis
const CUENTA = catalogos.cuentas.find((c) => c.empresa_id === PARIS_AUTOS)!.id

function semilla(n: number, tipo: string, estado: string, creado: string): Semilla {
  const op = `00000000-0000-4000-8000-0000000008${String(n).padStart(2, '0')}`
  return {
    operacion: { id: op, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, cliente_nombre: `Cliente ${n}`, cuenta_personal: `CP-${n}`, oferta_ref: `OF-${n}`, referencia_mail: null, created_at: creado },
    tramite: {
      id: `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, numero: `T-2026-005${String(n).padStart(2, '0')}`,
      operacion_id: op, tipo_id: tipo, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, estado, vehiculo_desc: 'Peugeot 208',
      dominio: `AB${n}00CD`, chasis: null, gestora_id: GESTORA, autorizado_at: creado, version: 2, created_at: creado,
    },
  }
}
const T1 = semilla(1, '00000000-0000-4000-8000-0000000000f1', 'devuelto', '2026-10-05T12:00:00.000Z')
const T2 = semilla(2, '00000000-0000-4000-8000-0000000000f1', 'en_gestoria', '2026-10-20T12:00:00.000Z')

function servidor() {
  return crearServidor([{ ...T1, presupuestos: ['100000000'] }, T2], {
    movimientos: [
      { id: '00000000-0000-4000-8000-000000000401', cuenta_id: CUENTA, tipo: 'carga', importe: '500000000', fecha_operacion: '2026-10-01', tramite_id: null, revierte_id: null, es_pago_final: false, created_at: '2026-10-01T12:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000402', cuenta_id: CUENTA, tipo: 'pago_tramite', importe: '-100000000', fecha_operacion: '2026-10-06', tramite_id: T1.tramite.id, revierte_id: null, es_pago_final: true, created_at: '2026-10-06T12:00:00.000Z' },
    ],
  })
}

async function abrir(page: Page, usuario: string, ruta = '/analisis') {
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor: servidor() })
  await page.goto(ruta)
  return mock
}

test('gerencia ve el análisis con líneas y donas, nunca barras', async ({ page }) => {
  await abrir(page, GERENTE)
  await expect(page.getByRole('heading', { name: 'Análisis', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Gasto real' })).toContainText('$ 1.000.000,00')
  await expect(page.getByRole('figure', { name: 'Gasto diario' }).locator('.recharts-line-curve')).toHaveCount(1)
  await expect(page.getByRole('figure', { name: 'Gasto diario' }).locator('.recharts-line-dots')).toHaveCount(1)
  await expect(page.getByRole('figure', { name: 'Gasto por tipo de trámite' }).locator('.recharts-pie')).toHaveCount(1)
  await expect(page.locator('.recharts-bar, .recharts-bar-rectangle')).toHaveCount(0)
})

test('previsión: con menos de 4 semanas dice historia insuficiente y muestra el saldo', async ({ page }) => {
  await abrir(page, CONTABLE, '/analisis?vista=prevision')
  await expect(page.getByTestId('aviso-prevision')).toContainText('Historia insuficiente')
  const tabla = page.getByRole('table', { name: 'Saldo contra lo previsto' })
  await expect(tabla).toContainText('Paris Autos')
})

test('contable ve parámetros pero no los edita; el MRPA figura a confirmar', async ({ page }) => {
  await abrir(page, CONTABLE, '/analisis?vista=parametros')
  const tabla = page.getByRole('table', { name: 'Parámetros del estimador' })
  await expect(tabla).toContainText('Valor del MRPA')
  await expect(tabla).toContainText('A confirmar')
  await expect(tabla.getByRole('button', { name: /Actualizar/ })).toHaveCount(0)
})

test('gerencia carga el MRPA con su fuente', async ({ page }) => {
  await abrir(page, GERENTE, '/analisis?vista=parametros')
  await page.getByRole('button', { name: /Actualizar Valor del MRPA/ }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Valor en pesos').fill('10.000')
  await d.getByRole('textbox', { name: 'Fuente' }).fill('Recibo de octubre 2026')
  await d.getByRole('button', { name: 'Guardar vigencia' }).click()
  await expect(d).toBeHidden()
  await expect(page.getByRole('table', { name: 'Parámetros del estimador' })).toContainText('Recibo de octubre 2026')
})

test('calcula el costo estimado desde el panel del trámite, con líneas sin dato', async ({ page }) => {
  await abrir(page, CONTABLE, '/tramites')
  await page.getByRole('row', { name: /T-2026-00502/ }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await detalle.getByRole('button', { name: 'Calcular estimado' }).click()
  const form = detalle.getByRole('form', { name: 'Calcular estimado' })
  await form.getByLabel('Valor de referencia').fill('38.814.516,57')
  await form.getByLabel('Monto de la prenda').fill('42.384.523,91')
  await form.getByRole('button', { name: 'Calcular' }).click()
  await expect(detalle.getByTestId('total-estimado')).toHaveText('$ 971.643,98')
  await expect(detalle).toContainText('Sin dato')
  await expect(detalle).toContainText('Parcial: hay líneas sin dato')
})

test('la gestora no ve el menú Análisis y la ruta la devuelve a su inicio', async ({ page }) => {
  const mock = await abrir(page, GESTORA, '/analisis')
  await expect(page).toHaveURL(/\/mis-tramites$/)
  await expect(page.getByRole('link', { name: 'Análisis' })).toHaveCount(0)
  expect(mock.rutasPedidas.filter((r) => /analisis|prevision|estimad|parametros/.test(r))).toEqual([])
})

test('gerencia importa la tabla DNRPA y el estimado usa la valuación del vehículo elegido', async ({ page }) => {
  await page.addInitScript((p) => { window.__valuacionesSimuladas = { 'valuaciones.pdf': p } }, paginasValuaciones)
  await abrir(page, GERENTE, '/analisis?vista=parametros')
  await page.getByRole('button', { name: 'Importar tabla de valuaciones' }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Archivo PDF').setInputFiles({ name: 'valuaciones.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
  await expect(d.getByTestId('vista-previa-valuaciones')).toContainText('modelos')
  await expect(d.getByTestId('vista-previa-valuaciones')).toContainText('1 renglones no se pudieron leer')
  await expect(d.getByLabel('Vigente desde')).toHaveValue('2026-10-01')
  await d.getByLabel('Disposición').fill('Disp. 160/2026')
  await d.getByRole('button', { name: /^Importar \d+ valores$/ }).click()
  await expect(d.getByRole('status')).toContainText('Listo: se importaron')
  await d.getByRole('button', { name: 'Listo' }).click()
  await expect(page.getByRole('region', { name: 'Tabla de valuaciones DNRPA' })).toContainText('Disp. 160/2026')

  await page.getByRole('link', { name: 'Trámites' }).first().click()
  await page.getByRole('row', { name: /T-2026-00502/ }).click()
  const detalle = page.getByRole('complementary', { name: 'Detalle del trámite' })
  await detalle.getByRole('button', { name: 'Calcular estimado' }).click()
  const form = detalle.getByRole('form', { name: 'Calcular estimado' })
  await form.getByLabel('Valor de referencia').fill('10.000.000')
  await form.getByLabel('Marca, modelo o versión').fill('kawasaki versys')
  await form.getByRole('button', { name: 'Buscar' }).click()
  const resultados = form.getByRole('list', { name: 'Resultados de la tabla DNRPA' })
  await expect(resultados.getByRole('button')).toHaveCount(1)
  await resultados.getByRole('button', { name: /VERSYS/ }).click()
  await expect(form).toContainText('Valuación $ 31.174.000,00')
  await form.getByRole('button', { name: 'Calcular' }).click()
  await expect(detalle.getByTestId('linea-valuacion')).toContainText('Valuación DNRPA Disp. 160/2026 — 06919847 (0 km)')
  await expect(detalle).toContainText('Base $ 31.174.000,00')
})
