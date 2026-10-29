import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { crearServidor, montarSupabase, type Extra, type Semilla, type Servidor } from './mock-supabase'
import catalogos from './fixtures/catalogos.json' with { type: 'json' }

export const GESTORA = '00000000-0000-4000-8000-000000000071'
export const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
export const PARIS_AUTOS = '00000000-0000-4000-8000-0000000000e1'

export async function abrir(page: Page, usuario: string, servidor: Servidor = crearServidor(), ruta = '/rendiciones') {
  await page.clock.setFixedTime(catalogos.ahora)
  const mock = await montarSupabase(page, [], { usuario, servidor })
  await page.goto(ruta)
  return mock
}

async function crearJulio(page: Page) {
  await page.getByRole('button', { name: 'Nueva rendición' }).first().click()
  const d = page.getByRole('dialog', { name: 'Nueva rendición' })
  await d.getByLabel('Razón social').selectOption({ label: 'Paris Autos' })
  await d.getByLabel('Mes').fill('2026-07')
  await d.getByLabel('Gestora').selectOption({ label: 'Gabriela Gestora' })
  await d.getByRole('button', { name: 'Crear rendición' }).click()
  return d
}

test('contable crea la rendición de julio 2026 de Paris Autos y la ve en la lista', async ({ page }) => {
  await abrir(page, CONTABLE)
  await expect(page.getByText('Todavía no hay rendiciones.')).toBeVisible()
  await crearJulio(page)
  await expect(page.getByRole('heading', { name: 'Paris Autos · Julio 2026' })).toBeVisible()
  await page.getByRole('button', { name: 'Rendiciones', exact: true }).click()
  const tabla = page.getByRole('table', { name: 'Rendiciones' })
  await expect(tabla.getByRole('row')).toHaveCount(2)
  await expect(tabla).toContainText('Paris Autos')
  await expect(tabla).toContainText('Julio 2026')
  await expect(tabla).toContainText('Borrador')
})

test('no deja crear dos veces el mismo mes', async ({ page }) => {
  await abrir(page, CONTABLE)
  await crearJulio(page)
  await page.getByRole('button', { name: 'Rendiciones', exact: true }).click()
  const d = await crearJulio(page)
  await expect(d.getByRole('alert')).toHaveText('Ya existe la rendición de ese mes para esa gestora y razón social.')
})

// --- Escenario de julio 2026: tres trámites de Paris Autos y una rendición en borrador ---------
const SUCURSAL = '00000000-0000-4000-8000-0000000000d1'
const TIPO = '00000000-0000-4000-8000-0000000000f2'
export const REND = '00000000-0000-4000-8000-00000000aa01'
const CUENTA_AUTOS = catalogos.cuentas.find((c) => c.empresa_id === PARIS_AUTOS)!.id

export function tramiteSemilla(n: number, cliente: string, dominio: string | null): Semilla {
  const op = `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
  return {
    operacion: { id: op, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, cliente_nombre: cliente, cuenta_personal: `CP-${n}`, oferta_ref: `OF-${n}`, referencia_mail: null, created_at: '2026-07-01T12:00:00.000Z' },
    tramite: {
      id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`, numero: `T-2026-007${String(n).padStart(2, '0')}`,
      operacion_id: op, tipo_id: TIPO, empresa_id: PARIS_AUTOS, sucursal_id: SUCURSAL, estado: 'devuelto', vehiculo_desc: 'Peugeot 208',
      dominio, chasis: null, gestora_id: GESTORA, autorizado_at: '2026-07-02T12:00:00.000Z', version: 5, created_at: '2026-07-01T12:00:00.000Z',
    },
  }
}

export const T_GODOY = tramiteSemilla(1, 'GODOY MARIO ESTEBAN', 'AA111AA')
export const T_JOFRE = tramiteSemilla(2, 'JOFRE FABRICIO ALEJANDRO', 'AF869NV')
export const T_SUAREZ = tramiteSemilla(3, 'SUAREZ OSCAR RAUL', 'LZI780')

export const pago = (n: number, tramite: string, importe: string) => ({
  id: `00000000-0000-4000-8000-0000000006${String(n).padStart(2, '0')}`, cuenta_id: CUENTA_AUTOS, tipo: 'pago_tramite',
  importe: `-${importe}`, fecha_operacion: '2026-07-15', tramite_id: tramite, revierte_id: null, es_pago_final: true,
  creado_por: GESTORA, created_at: '2026-07-15T15:00:00.000Z',
})

export function escenario(extra: Extra = {}, semillas: Semilla[] = [T_GODOY, T_JOFRE, T_SUAREZ]) {
  return crearServidor(semillas, {
    rendiciones: [{ id: REND, empresa_id: PARIS_AUTOS, gestora_id: GESTORA, periodo: '2026-07-01', honorario: '3250000', estado: 'borrador', motivo_observacion: null, creado_por: GESTORA, created_at: '2026-08-01T12:00:00.000Z', version: 1 }],
    ...extra,
  })
}

test('importa la planilla desde Excel: 3 filas, vincula 2 por dominio y marca 1 sin vincular; el total suma $ 1.864.715,82', async ({ page }) => {
  // GODOY no tiene trámite en este escenario: queda sin vincular.
  await abrir(page, CONTABLE, escenario({}, [T_JOFRE, T_SUAREZ]), `/rendiciones?r=${REND}`)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Julio')
  ws.addRow(['NOMBRE', 'PAGO', 'HONORARIOS'])
  ws.addRow(['GODOY MARIO ESTEBAN', 1163855.24, 32500])
  ws.addRow(['JOFRE FABRICIO ALEJANDRO AF869NV', 431539.69, 32500])
  ws.addRow(['SUAREZ OSCAR RAUL LZI780', 269320.89, 32500])
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  await page.getByLabel('Archivo de la planilla').setInputFiles({ name: 'julio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  const tabla = page.getByRole('table', { name: 'Filas de la planilla' })
  await expect(tabla.locator('tbody tr')).toHaveCount(3)
  await expect(tabla.getByText(/^Vinculado/)).toHaveCount(2)
  await expect(tabla.getByText('Sin vincular')).toHaveCount(1)
  await expect(page.getByTestId('total-pago')).toHaveText('$ 1.864.715,82')
  await page.getByRole('button', { name: 'Guardar planilla' }).click()
  await expect(page.getByText('Planilla guardada.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('table', { name: 'Filas de la planilla' }).locator('tbody tr')).toHaveCount(3)
})

// --- Comprobantes: la lectura se simula con el texto de los fixtures (window.__ocrSimulado) -----
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'rendiciones', '__fixtures__')
const texto = (n: string) => readFileSync(join(FIX, n), 'utf8')
export const FILA_GODOY = '00000000-0000-4000-8000-00000000ab01'

export function conPlanilla(extra: Extra = {}) {
  return escenario({
    rendicionFilas: [{ id: FILA_GODOY, rendicion_id: REND, orden: 1, nombre: 'GODOY MARIO ESTEBAN', dominio: null, pago: '94015398', honorarios: '3250000', tramite_id: T_GODOY.tramite.id, vinculo: 'auto', candidatos: [T_GODOY.tramite.id] }],
    ...extra,
  })
}

async function simularOcr(page: Page, textos: Record<string, string>) {
  await page.addInitScript((t) => { (window as unknown as { __ocrSimulado: Record<string, string> }).__ocrSimulado = t }, textos)
}
const archivo = (name: string, contenido = name) => ({ name, mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', buffer: Buffer.from(contenido) })

test('sube un recibo y una retención, los asigna a GODOY por nombre y dominio, y al confirmar quedan vinculados', async ({ page }) => {
  await simularOcr(page, { 'recibo.pdf': texto('recibo-dnrpa.txt'), 'sellos.jpg': texto('retencion-sellos.txt') })
  await abrir(page, CONTABLE, conPlanilla(), `/rendiciones?r=${REND}&vista=comprobantes`)
  await page.getByLabel('Archivos de comprobantes').setInputFiles([archivo('recibo.pdf'), archivo('sellos.jpg')])
  const lista = page.getByRole('list', { name: 'Lista de comprobantes' })
  await expect(lista.getByRole('listitem')).toHaveCount(2)
  await expect(lista.getByText('GODOY MARIO ESTEBAN')).toHaveCount(2)
  const form = page.getByRole('form', { name: 'Datos del comprobante' })
  await form.getByRole('button', { name: 'Confirmar' }).click()
  await expect(lista.getByText('Confirmado')).toHaveCount(1)
  // Enter confirma el siguiente pendiente.
  await form.getByRole('textbox').first().press('Enter')
  await expect(lista.getByText('Confirmado')).toHaveCount(2)
  await expect(lista).toContainText('$ 431.539,69')
  await expect(lista).toContainText('$ 508.614,29')
})

test('el mismo archivo dos veces avisa duplicado', async ({ page }) => {
  await simularOcr(page, { 'recibo.pdf': texto('recibo-dnrpa.txt') })
  await abrir(page, CONTABLE, conPlanilla(), `/rendiciones?r=${REND}&vista=comprobantes`)
  const subir = page.getByLabel('Archivos de comprobantes')
  await subir.setInputFiles([archivo('recibo.pdf')])
  await expect(page.getByRole('list', { name: 'Lista de comprobantes' }).getByRole('listitem')).toHaveCount(1)
  await subir.setInputFiles([archivo('recibo.pdf')])
  const lista = page.getByRole('list', { name: 'Lista de comprobantes' })
  await expect(lista.getByRole('listitem')).toHaveCount(2)
  await expect(lista.getByText('Posible duplicado')).toHaveCount(2)
  await expect(page.getByRole('alert').filter({ hasText: 'el mismo archivo ya se cargó' })).toBeVisible()
})

test('un archivo ilegible queda pendiente con todos los campos para completar', async ({ page }) => {
  await simularOcr(page, { 'borroso.jpg': '%%% ###' })
  await abrir(page, CONTABLE, conPlanilla(), `/rendiciones?r=${REND}&vista=comprobantes`)
  await page.getByLabel('Archivos de comprobantes').setInputFiles([archivo('borroso.jpg')])
  const lista = page.getByRole('list', { name: 'Lista de comprobantes' })
  await expect(lista.getByText('Otro comprobante')).toBeVisible()
  await expect(lista.getByText('Pendiente')).toBeVisible()
  const form = page.getByRole('form', { name: 'Datos del comprobante' })
  await expect(form.getByText('Revisar', { exact: true })).toHaveCount(7)
  await expect(form.getByText('Pendiente de revisión')).toBeVisible()
})

test('la gestora no ve Rendiciones en el menú y /rendiciones la redirige', async ({ page }) => {
  await abrir(page, GESTORA, escenario())
  await expect(page).toHaveURL(/\/mis-tramites/)
  await expect(page.getByRole('link', { name: 'Rendiciones' })).toHaveCount(0)
})

// --- Controles y aprobación -----------------------------------------------------------------------
function paraControlar(estado: string, totalSellos = '50861429') {
  const comp = (n: number, tipo: string, numero: string, total: string) => ({
    id: `00000000-0000-4000-8000-00000000ac0${n}`, rendicion_id: REND, fila_id: FILA_GODOY, tipo, archivo_path: null,
    archivo_sha256: `h${n}`, pagina: 1, numero, emisor: null, emisor_cuit: null, fecha: '2026-07-01', total, dominio: 'AA111AA',
    documento: null, datos_extraidos: {}, revision: 'confirmado', created_at: '2026-08-01T12:00:00.000Z',
  })
  const s = conPlanilla({
    movimientos: [pago(1, T_GODOY.tramite.id, '94015398')],
    comprobantes: [
      comp(1, 'recibo_dnrpa', '171648', '43153969'),
      comp(2, 'retencion_sellos', '0000115277', totalSellos),
      comp(3, 'factura_honorarios', '0001-00010391', '3250000'),
    ],
  })
  s.st.rendiciones[0].estado = estado
  return s
}

const tarjeta = (page: Page, nombre: string) => page.getByRole('region', { name: `Control de ${nombre}` })

test('contable ve los tres controles en verde y aprueba', async ({ page }) => {
  const s = paraControlar('enviada')
  const mock = await abrir(page, CONTABLE, s, `/rendiciones?r=${REND}&vista=controles`)
  for (const n of ['importes', 'autorizados', 'honorarios']) await expect(tarjeta(page, n)).toContainText('OK')
  await expect(page.getByTestId('detalle-honorarios')).toHaveText('1 trámites × $ 32.500,00 = $ 32.500,00 — facturado $ 32.500,00')
  await expect(page.getByText('Monto a pagar de honorarios: $ 32.500,00')).toBeVisible()
  await page.getByRole('button', { name: 'Aprobar' }).click()
  const d = page.getByRole('dialog', { name: 'Aprobar rendición' })
  await expect(d).toContainText('Los tres controles están en verde.')
  await d.getByRole('button', { name: 'Aprobar' }).click()
  await expect(page.getByText('Aprobada').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible()
  // Aprobar no crea movimientos.
  expect(s.st.movimientos).toHaveLength(1)
  expect(mock.rutasPedidas.filter((r) => /registrar_|revertir_/.test(r))).toEqual([])
})

test('con un peso de diferencia el control de importes queda en rojo y muestra la fila', async ({ page }) => {
  await abrir(page, CONTABLE, paraControlar('borrador', '50861529'), `/rendiciones?r=${REND}&vista=controles`)
  const imp = tarjeta(page, 'importes')
  await expect(imp).toContainText('Con diferencias')
  await expect(imp.getByRole('list', { name: 'Filas con diferencia' })).toContainText('GODOY MARIO ESTEBAN · $ 1,00')
  await imp.getByRole('button', { name: 'Ver comprobantes' }).click()
  await expect(page.getByText('Mostrando los comprobantes de GODOY MARIO ESTEBAN.')).toBeVisible()
})

test('aprobar con diferencias pide confirmación', async ({ page }) => {
  await abrir(page, CONTABLE, paraControlar('enviada', '50861529'), `/rendiciones?r=${REND}&vista=controles`)
  await page.getByRole('button', { name: 'Aprobar' }).click()
  const d = page.getByRole('dialog', { name: 'Aprobar rendición' })
  await expect(d).toContainText('Hay diferencias sin resolver. ¿Aprobar igual?')
  await d.getByRole('button', { name: 'Aprobar' }).click()
  await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible()
})

test('en borrador no se ofrece aprobar: primero se envía a control', async ({ page }) => {
  await abrir(page, CONTABLE, paraControlar('borrador'), `/rendiciones?r=${REND}&vista=controles`)
  await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Enviar a control' }).click()
  await page.getByRole('dialog', { name: 'Enviar a control' }).getByRole('button', { name: 'Enviar a control' }).click()
  await expect(page.getByRole('button', { name: 'Aprobar' })).toBeVisible()
})

test.describe('celular (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } })
  const sinScrollHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  test('la lista y la revisión de comprobantes entran sin scroll horizontal', async ({ page }) => {
    await simularOcr(page, { 'recibo.pdf': texto('recibo-dnrpa.txt') })
    await abrir(page, CONTABLE, conPlanilla())
    await expect(page.getByRole('list', { name: 'Rendiciones (lista)' })).toContainText('Paris Autos')
    expect(await sinScrollHorizontal(page)).toBe(true)
    await page.getByRole('list', { name: 'Rendiciones (lista)' }).getByRole('button').first().click()
    await page.getByRole('tab', { name: 'Comprobantes' }).click()
    await page.getByLabel('Archivos de comprobantes').setInputFiles([archivo('recibo.pdf')])
    await expect(page.getByRole('form', { name: 'Datos del comprobante' })).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
  })
})
