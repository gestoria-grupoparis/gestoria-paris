import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'
import fixture from '../../web/e2e/fixtures/escenario-saldos.json' with { type: 'json' }

beforeEach(resetDb)

type Saldo = { registrado_cents: bigint; comprometido_cents: bigint; disponible_cents: bigint }
const S = (r: Saldo) => [r.registrado_cents, r.comprometido_cents, r.disponible_cents]
// El E2E sirve v_saldos desde este fixture: cada paso tiene que coincidir con la base real.
const paso = (firma: string) => {
  const p = fixture.pasos.find((x) => x.firma === firma)
  if (!p) throw new Error(`Paso sin fixture: ${firma}`)
  return [BigInt(p.registrado_cents), BigInt(p.comprometido_cents), BigInt(p.disponible_cents)]
}

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const FECHA = '2026-10-27'

test('escenario integral (sección K): saldos de Paris Autos con San Luis y San Juan', async () => {
  const gerenciaGeneral = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contableSL = await crearUsuario('contable', [{ empresa: 'Paris Autos', sucursal: 'San Luis Capital' }])
  const gerenciaSJ = await crearUsuario('gerencia', [{ empresa: 'Paris Autos', sucursal: 'San Juan' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')

  const saldo = async (nombre: string) =>
    comoUsuario(gerenciaGeneral, async (c) =>
      (await c.query(`select * from public.v_saldos where empresa = $1`, [nombre])).rows[0] as Saldo,
    )
  const finanzas = async (tramite: string) =>
    comoUsuario(contableSL, async (c) =>
      (await c.query(`select * from public.v_tramite_finanzas where tramite_id = $1`, [tramite])).rows[0],
    )
  const carga = (importe: bigint) =>
    rpc(gerenciaGeneral, 'registrar_carga', {
      p_idem: randomUUID(), p_empresa: empresa, p_importe: importe, p_fecha: FECHA,
    })
  const tramitePresupuestado = async (userId: string, sucursal: string, oferta: string, total: bigint) => {
    const id = (
      await rpc(userId, 'crear_tramite', {
        p_idem: randomUUID(),
        p_empresa: empresa,
        p_sucursal: await idPorNombre('sucursales', sucursal),
        p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + oferta,
        p_cuenta_personal: 'CP-' + oferta,
        p_oferta: oferta,
        p_vehiculo: 'Fiat Cronos 1.3',
        p_dominio: 'D' + oferta,
      })
    ).rows[0].crear_tramite as string
    await rpc(userId, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    await rpc(userId, 'registrar_presupuesto', {
      p_tramite: id, p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n,
    })
    return id
  }

  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=0,presupuestos=0,pagos=0'))
  await carga(300000000n)
  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=1,presupuestos=0,pagos=0'))
  const t1 = await tramitePresupuestado(contableSL, 'San Luis Capital', 'OF-1', 70000000n)
  expect(S(await saldo('Paris Autos'))).toEqual([300000000n, 70000000n, 230000000n])
  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=1,presupuestos=1,pagos=0'))

  await tramitePresupuestado(gerenciaSJ, 'San Juan', 'OF-2', 90000000n)
  expect(S(await saldo('Paris Autos'))).toEqual([300000000n, 160000000n, 140000000n])
  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=1,presupuestos=2,pagos=0'))

  await rpc(contableSL, 'registrar_pago', {
    p_idem: randomUUID(), p_tramite: t1, p_fecha: FECHA,
    p_arancel: 65000000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: true,
  })
  expect(S(await saldo('Paris Autos'))).toEqual([235000000n, 90000000n, 145000000n])
  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=1,presupuestos=2,pagos=1'))

  await carga(200000000n)
  expect(S(await saldo('Paris Autos'))).toEqual([435000000n, 90000000n, 345000000n])
  expect(S(await saldo('Paris Autos'))).toEqual(paso('cargas=2,presupuestos=2,pagos=1'))
  // Los perfiles por sucursal no ven el saldo (el E2E lo verifica en pantalla).
  for (const u of [contableSL, gerenciaSJ])
    expect(await comoUsuario(u, async (c) => (await c.query('select * from public.v_saldos')).rows)).toEqual([])

  expect((await finanzas(t1)).desvio_cents).toBe(-5000000n)
})
