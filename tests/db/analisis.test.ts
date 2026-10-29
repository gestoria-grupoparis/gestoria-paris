import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [])
  const [{ id: empresa }] = await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`)
  const [{ id: sucursal }] = await sqlAdmin(`select id from public.sucursales where nombre = 'San Luis Capital'`)
  let n = 0
  const carga = (importe: bigint, fecha: string) =>
    rpc(gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: empresa, p_importe: importe, p_fecha: fecha })
  const tramite = async (tipo = 'patentamiento_0km', presupuesto: bigint | null = 1_000_00n) => {
    n += 1
    const id = (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: tipo,
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    if (presupuesto)
      await rpc(gerencia, 'registrar_presupuesto', {
        p_tramite: id, p_arancel: presupuesto, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: null,
      })
    return id
  }
  const pago = (t: string, arancel: bigint, sellado: bigint, fecha: string, final = true) =>
    rpc(gerencia, 'registrar_pago', {
      p_idem: randomUUID(), p_tramite: t, p_fecha: fecha,
      p_arancel: arancel, p_prenda: 0n, p_sellado: sellado, p_otros: 0n, p_es_final: final,
    })
  return { gerencia, gestora, empresa, carga, tramite, pago }
}

const analisis = (por: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) =>
  rpc(por, 'analisis_gastos', { p_desde: desde, p_hasta: hasta, p_empresa: null, p_sucursal: null, p_tipo: null, ...extra })
    .then((r) => r.rows[0].analisis_gastos)

test('gasto real por período, concepto, tipo y variación; sin período anterior la variación es null', async () => {
  const f = await preparar()
  await f.carga(100_000_00n, '2026-09-01')
  const a = await f.tramite()
  const b = await f.tramite('transferencia_usado')
  await f.pago(a, 600_00n, 400_00n, '2026-10-05')
  await f.pago(b, 300_00n, 0n, '2026-10-20')
  const r = await analisis(f.gerencia, '2026-10-01', '2026-10-31')
  expect(r.kpis.gasto_cents).toBe('130000')
  expect(r.kpis.gasto_anterior_cents).toBe('0')
  expect(r.kpis.variacion_pct).toBeNull()
  expect(r.por_concepto.find((c: { etiqueta: string }) => c.etiqueta === 'arancel').cents).toBe('90000')
  expect(r.por_concepto.find((c: { etiqueta: string }) => c.etiqueta === 'sellos').cents).toBe('40000')
  expect(r.por_tipo).toHaveLength(2)
  expect(r.serie).toHaveLength(31)
  expect(r.serie.find((p: { fecha: string }) => p.fecha === '2026-10-05').gasto_cents).toBe('100000')
  const solo = await analisis(f.gerencia, '2026-10-01', '2026-10-31', { p_tipo: 'transferencia_usado' })
  expect(solo.kpis.gasto_cents).toBe('30000')
  const vacio = await analisis(f.gerencia, '2026-08-01', '2026-08-31')
  expect(vacio.kpis.gasto_cents).toBe('0')
  expect(vacio.kpis.variacion_pct).toBeNull()
})

test('estimado pendiente: trámites en curso sin presupuesto con su último estimado', async () => {
  const f = await preparar()
  const t = await f.tramite('patentamiento_0km', null)
  await rpc(f.gerencia, 'estimar_tramite', {
    p_tramite: t, p_valor: 3881451657n, p_prenda: 4238452391n, p_vehiculo: 'auto', p_destino: 'cliente', p_provincia: null,
  })
  const r = await analisis(f.gerencia, '2026-10-01', '2026-10-31')
  expect(r.kpis.estimado_pendiente_cents).toBe('97164398')
})

test('la gestora no accede al análisis ni a la previsión', async () => {
  const f = await preparar()
  await expect(analisis(f.gestora, '2026-10-01', '2026-10-31')).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(f.gestora, 'prevision_fondos', { p_hoy: '2026-10-29', p_empresa: null })).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(analisis(f.gerencia, '2026-10-31', '2026-10-01')).rejects.toThrow(/^DATO_INVALIDO:/)
})

const prevision = (por: string, hoy: string) =>
  rpc(por, 'prevision_fondos', { p_hoy: hoy, p_empresa: null }).then((r) => r.rows[0].prevision_fondos)

test('previsión: con menos de 4 semanas de historia dice insuficiente y solo usa el pipeline', async () => {
  const f = await preparar()
  await f.carga(10_000_00n, '2026-10-01')
  const a = await f.tramite()
  await f.pago(a, 500_00n, 0n, '2026-10-20')
  await f.tramite('patentamiento_0km', 2_000_00n) // en curso, sin pagar: pipeline
  const p = await prevision(f.gerencia, '2026-10-29')
  expect(p.suficiente).toBe(false)
  expect(p.semanas_historia).toBe(1)
  expect(p.semanas[0].base_cents).toBeNull()
  expect(p.semanas[0].pipeline_cents).toBe('200000')
  expect(p.semanas[0].previsto_cents).toBe('200000')
  const s = p.saldos[0]
  expect(s.registrado_cents).toBe('950000')
  expect(s.previsto_4_cents).toBe('200000')
  expect(s.alerta).toBe(false)
})

test('previsión: promedio de 4 semanas sin sumar dos veces el pipeline, y alerta si no alcanza', async () => {
  const f = await preparar()
  await f.carga(10_000_00n, '2026-09-01')
  // Semanas (lunes) 21/09, 28/09, 05/10, 12/10, 19/10: 1.000, 1.000, 1.000, 1.000, 3.000
  for (const [fecha, monto] of [['2026-09-22', 1_000_00n], ['2026-09-29', 1_000_00n], ['2026-10-06', 1_000_00n],
    ['2026-10-13', 1_000_00n], ['2026-10-20', 3_000_00n]] as const) {
    const t = await f.tramite('patentamiento_0km', monto)
    await f.pago(t, monto, 0n, fecha)
  }
  await f.tramite('patentamiento_0km', 500_00n) // pipeline menor que el promedio: no se suma encima
  const p = await prevision(f.gerencia, '2026-10-29')
  expect(p.suficiente).toBe(true)
  expect(p.semanas_historia).toBe(5)
  expect(p.semanas[0].base_cents).toBe('150000') // (1000+1000+1000+3000)/4
  expect(p.semanas[0].pipeline_cents).toBe('50000')
  expect(p.semanas[0].previsto_cents).toBe('150000')
  expect(p.semanas).toHaveLength(4)
  expect(BigInt(p.semanas[0].alto_cents)).toBeGreaterThanOrEqual(150000n)
  // registrado 10.000 - 7.000 = 3.000 < previsto en 4 semanas (4 x 1.500) => alerta
  expect(p.saldos[0].alerta).toBe(true)
})
