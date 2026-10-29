import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }, { empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const otra = await idPorNombre('empresas', 'Paris Cars')
  const sucursal = await idPorNombre('sucursales', 'San Luis Capital')
  let n = 0
  const carga = (emp: string, importe: bigint, fecha: string) =>
    rpc(gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: emp, p_importe: importe, p_fecha: fecha })
  const tramite = async (total: bigint) => {
    n += 1
    const id = (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos 1.3', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    await rpc(gerencia, 'registrar_presupuesto', {
      p_tramite: id, p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: null,
    })
    return id
  }
  const pago = (t: string, total: bigint, fecha: string, final: boolean) =>
    rpc(gerencia, 'registrar_pago', {
      p_idem: randomUUID(), p_tramite: t, p_fecha: fecha,
      p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: final,
    })
  return { gerencia, gestora, empresa, otra, carga, tramite, pago }
}

test('cierre mensual: saldo inicial, movimientos del mes por tipo y saldo final por razón social', async () => {
  const { gerencia, empresa, otra, carga, tramite, pago } = await preparar()
  await carga(empresa, 1_000_00n, '2026-09-15') // mes anterior: forma el saldo inicial
  await carga(empresa, 500_00n, '2026-10-01')
  const t = await tramite(300_00n)
  await pago(t, 320_00n, '2026-10-31', true)
  await rpc(gerencia, 'registrar_ajuste', {
    p_idem: randomUUID(), p_empresa: empresa, p_importe: -10_00n, p_fecha: '2026-10-10', p_motivo: 'comisión',
  })
  await rpc(gerencia, 'registrar_reintegro', {
    p_idem: randomUUID(), p_tramite: t, p_importe: 20_00n, p_fecha: '2026-10-20', p_motivo: 'devolución',
  })
  await carga(empresa, 999_00n, '2026-11-01') // mes siguiente: no entra

  const filas = (await rpc(gerencia, 'informe_cierre_mensual', { p_mes: '2026-10-17' })).rows
  const autos = filas.find((f) => f.empresa_id === empresa)!
  expect(autos).toMatchObject({
    mes: expect.any(Date),
    empresa: 'Paris Autos',
    saldo_inicial_cents: 1_000_00n,
    cargas_cents: 500_00n,
    pagos_cents: 320_00n,
    ajustes_cents: -10_00n,
    reintegros_cents: 20_00n,
    reversiones_cents: 0n,
    saldo_final_cents: 1_190_00n,
    movimientos: 4,
  })
  expect(filas.find((f) => f.empresa_id === otra)).toMatchObject({ saldo_inicial_cents: 0n, saldo_final_cents: 0n })

  const solo = (await rpc(gerencia, 'informe_cierre_mensual', { p_mes: '2026-10-01', p_empresa: otra })).rows
  expect(solo.map((f) => f.empresa_id)).toEqual([otra])
})

test('cierre mensual respeta alcance y rol', async () => {
  const { empresa, otra } = await preparar()
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const filas = (await rpc(contable, 'informe_cierre_mensual', { p_mes: '2026-10-01' })).rows
  expect(filas.map((f) => f.empresa_id)).toEqual([empresa])
  await expect(rpc(contable, 'informe_cierre_mensual', { p_mes: '2026-10-01', p_empresa: otra }))
    .rejects.toThrow(/SIN_PERMISO/)
  const gestora = await crearUsuario('gestora', [])
  await expect(rpc(gestora, 'informe_cierre_mensual', { p_mes: '2026-10-01' })).rejects.toThrow(/SIN_PERMISO/)
  await expect(rpc(contable, 'informe_cierre_mensual', { p_mes: null })).rejects.toThrow(/DATO_INVALIDO/)
})

test('costos por trámite: lo pagado en el mes (fecha del pago) contra el presupuesto, con desvío', async () => {
  const { gerencia, empresa, carga, tramite, pago } = await preparar()
  await carga(empresa, 5_000_00n, '2026-09-01')
  const a = await tramite(300_00n)
  await pago(a, 100_00n, '2026-09-30', false)
  await pago(a, 230_00n, '2026-10-02', true)
  const b = await tramite(200_00n)
  await pago(b, 150_00n, '2026-10-05', false)
  const c = await tramite(100_00n)
  await pago(c, 100_00n, '2026-11-01', true)

  const filas = (await rpc(gerencia, 'informe_costos_tramites', { p_mes: '2026-10-01' })).rows
  expect(filas.map((f) => f.tramite_id).sort()).toEqual([a, b].sort())
  expect(filas.find((f) => f.tramite_id === a)).toMatchObject({
    empresa: 'Paris Autos', tipo: expect.any(String), cliente: 'Cliente 1',
    presupuesto_cents: 300_00n, costo_mes_cents: 230_00n, pagado_total_cents: 330_00n,
    pago_final: true, desvio_cents: 30_00n, desvio_pct: '10.00',
  })
  expect(filas.find((f) => f.tramite_id === b)).toMatchObject({
    costo_mes_cents: 150_00n, pago_final: false, desvio_cents: null, desvio_pct: null,
  })

  const contable = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  expect((await rpc(contable, 'informe_costos_tramites', { p_mes: '2026-10-01' })).rows).toEqual([])
  await expect(rpc(contable, 'informe_costos_tramites', { p_mes: '2026-10-01', p_empresa: empresa }))
    .rejects.toThrow(/SIN_PERMISO/)
})
