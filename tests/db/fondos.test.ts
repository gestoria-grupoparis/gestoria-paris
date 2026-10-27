import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const FECHA = '2026-10-27'

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

// Gerencia con alcance sobre todo Paris Autos opera y lee las vistas.
async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'San Luis')
  let n = 0

  const carga = (importe: bigint) =>
    rpc(gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: empresa, p_importe: importe, p_fecha: FECHA })

  const presupuesto = (tramite: string, total: bigint, motivo: string | null = null) =>
    rpc(gerencia, 'registrar_presupuesto', {
      p_tramite: tramite, p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: motivo,
    })

  // Trámite autorizado; con total, además presupuestado.
  const tramite = async (total?: bigint) => {
    n += 1
    const id = (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos 1.3', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    if (total !== undefined) await presupuesto(id, total)
    return id
  }

  const pago = (tramite: string, total: bigint, final: boolean) =>
    rpc(gerencia, 'registrar_pago', {
      p_idem: randomUUID(), p_tramite: tramite, p_fecha: FECHA,
      p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: final,
    })

  const cancelar = async (tramite: string) => {
    const [{ version }] = await sqlAdmin(`select version from public.tramites where id = $1`, [tramite])
    await rpc(gerencia, 'cambiar_estado', {
      p_tramite: tramite, p_estado: 'cancelado', p_motivo: 'la venta se cayó', p_version: version,
    })
  }

  const finanzas = (tramite: string) =>
    comoUsuario(gerencia, async (c) =>
      (await c.query(`select * from public.v_tramite_finanzas where tramite_id = $1`, [tramite])).rows[0],
    )

  const saldo = () =>
    comoUsuario(gerencia, async (c) => {
      const r = (await c.query(`select * from public.v_saldos where empresa = 'Paris Autos'`)).rows[0]
      return [r.registrado_cents, r.comprometido_cents, r.disponible_cents]
    })

  return { gerencia, carga, presupuesto, tramite, pago, cancelar, finanzas, saldo }
}

test('cancelar un trámite comprometido libera el comprometido', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const t = await f.tramite(50000000n)
  expect((await f.finanzas(t)).comprometido_cents).toBe(50000000n)
  expect(await f.saldo()).toEqual([100000000n, 50000000n, 50000000n])

  await f.cancelar(t)

  const r = await f.finanzas(t)
  expect([r.pagado_cents, r.comprometido_cents, r.situacion]).toEqual([0n, 0n, 'no_aplica'])
  expect(await f.saldo()).toEqual([100000000n, 0n, 100000000n])
})

test('cancelar con pagos conserva los pagos y comprometido 0', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const t = await f.tramite(50000000n)
  await f.pago(t, 20000000n, false)

  await f.cancelar(t)

  const r = await f.finanzas(t)
  expect([r.pagado_cents, r.comprometido_cents, r.desvio_cents]).toEqual([20000000n, 0n, null])
  expect(await f.saldo()).toEqual([80000000n, 0n, 80000000n])
})

test('pago mayor al presupuesto: desvío positivo, comprometido 0', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const t = await f.tramite(50000000n)
  await f.pago(t, 60000000n, true)

  const r = await f.finanzas(t)
  expect([r.presupuesto_cents, r.pagado_cents, r.comprometido_cents, r.desvio_cents, r.desvio_pct, r.situacion])
    .toEqual([50000000n, 60000000n, 0n, 10000000n, '20.00', 'pagado'])
  expect(await f.saldo()).toEqual([40000000n, 0n, 40000000n])
})

test('pagos parciales: comprometido baja con cada pago y es 0 con el final', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const t = await f.tramite(50000000n)

  await f.pago(t, 20000000n, false)
  let r = await f.finanzas(t)
  expect([r.pagado_cents, r.comprometido_cents, r.desvio_cents, r.situacion])
    .toEqual([20000000n, 30000000n, null, 'pagado_parcial'])
  expect(await f.saldo()).toEqual([80000000n, 30000000n, 50000000n])

  await f.pago(t, 25000000n, true)
  r = await f.finanzas(t)
  expect([r.pagado_cents, r.comprometido_cents, r.desvio_cents, r.desvio_pct, r.situacion])
    .toEqual([45000000n, 0n, -5000000n, '-10.00', 'pagado'])
  expect(await f.saldo()).toEqual([55000000n, 0n, 55000000n])
})

test('nueva versión de presupuesto recalcula comprometido', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const t = await f.tramite(50000000n)
  await f.presupuesto(t, 80000000n, 'cambió el arancel')

  const r = await f.finanzas(t)
  expect([r.presupuesto_cents, r.comprometido_cents, r.situacion]).toEqual([80000000n, 80000000n, 'comprometido'])
  expect(await f.saldo()).toEqual([100000000n, 80000000n, 20000000n])
})

test('segundo trámite que excede el saldo queda sin_fondos; una carga lo destraba sin intervención', async () => {
  const f = await preparar()
  await f.carga(100000000n)
  const sinPresupuesto = await f.tramite()
  const t1 = await f.tramite(60000000n)
  const t2 = await f.tramite(60000000n)

  expect((await f.finanzas(sinPresupuesto)).situacion).toBe('sin_presupuesto')
  expect((await f.finanzas(t1)).situacion).toBe('comprometido')
  expect((await f.finanzas(t2)).situacion).toBe('sin_fondos')
  expect(await f.saldo()).toEqual([100000000n, 120000000n, -20000000n])

  await f.carga(20000000n)

  expect((await f.finanzas(t1)).situacion).toBe('comprometido')
  expect((await f.finanzas(t2)).situacion).toBe('comprometido')
})

test('aprobar_excepcion_fondos de gerencia quita sin_fondos; contable recibe SIN_PERMISO', async () => {
  const f = await preparar()
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  await f.carga(100000000n)
  await f.tramite(60000000n)
  const t2 = await f.tramite(60000000n)
  expect((await f.finanzas(t2)).situacion).toBe('sin_fondos')

  await expect(rpc(contable, 'aprobar_excepcion_fondos', { p_tramite: t2, p_motivo: 'urgente' }))
    .rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(f.gerencia, 'aprobar_excepcion_fondos', { p_tramite: t2, p_motivo: '  ' }))
    .rejects.toThrow(/^DATO_INVALIDO:/)

  await rpc(f.gerencia, 'aprobar_excepcion_fondos', { p_tramite: t2, p_motivo: 'cliente con entrega pactada' })

  expect((await f.finanzas(t2)).situacion).toBe('comprometido')
  const [ex] = await sqlAdmin(`select aprobado_por, motivo from public.excepciones_fondos where tramite_id = $1`, [t2])
  expect(ex).toEqual({ aprobado_por: f.gerencia, motivo: 'cliente con entrega pactada' })
  const [ev] = await sqlAdmin(
    `select actor_id, motivo from public.eventos where entidad = 'excepciones_fondos' and entidad_id = $1`,
    [t2],
  )
  expect(ev).toEqual({ actor_id: f.gerencia, motivo: 'cliente con entrega pactada' })
})

test('las vistas filtran por usuario: gestora solo sus trámites autorizados; saldos solo con alcance de empresa', async () => {
  const f = await preparar()
  const t = await f.tramite(50000000n)
  const [{ gestora_id: gestora }] = await sqlAdmin(`select gestora_id from public.tramites where id = $1`, [t])
  const otraGestora = await crearUsuario('gestora', [])
  const contableSJ = await crearUsuario('contable', [{ empresa: 'Paris Autos', sucursal: 'San Juan' }])
  const contableSL = await crearUsuario('contable', [{ empresa: 'Paris Autos', sucursal: 'San Luis' }])

  const ver = (userId: string, vista: string) =>
    comoUsuario(userId, async (c) => (await c.query(`select * from public.${vista}`)).rows)

  expect((await ver(gestora, 'v_tramite_finanzas')).map((r) => r.tramite_id)).toEqual([t])
  expect(await ver(otraGestora, 'v_tramite_finanzas')).toEqual([])
  expect(await ver(contableSJ, 'v_tramite_finanzas')).toEqual([])
  expect((await ver(contableSL, 'v_tramite_finanzas')).map((r) => r.tramite_id)).toEqual([t])

  expect(await ver(gestora, 'v_saldos')).toEqual([])
  expect(await ver(contableSL, 'v_saldos')).toEqual([])
  expect((await ver(f.gerencia, 'v_saldos')).map((r) => r.empresa)).toEqual(['Paris Autos'])
})
