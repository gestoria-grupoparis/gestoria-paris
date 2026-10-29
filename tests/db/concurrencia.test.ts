import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeEach, expect, test } from 'vitest'
// @ts-expect-error módulo ESM sin tipos
import { TEST_DB_URL } from '../../scripts/test-db.mjs'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const FECHA = '2026-10-27'
const url: string = process.env.TEST_DB_URL ?? TEST_DB_URL

// Dos pools independientes: cada lado de la carrera usa su propia conexión.
const pools = [new pg.Pool({ connectionString: url, max: 1 }), new pg.Pool({ connectionString: url, max: 1 })]
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()))
})

// Barrera: ninguna llamada arranca hasta que las dos transacciones estén abiertas.
function barrera(n: number) {
  let llegados = 0
  let liberar!: () => void
  const abierta = new Promise<void>((r) => (liberar = r))
  return async () => {
    llegados += 1
    if (llegados === n) liberar()
    await abierta
  }
}

// Como rpc() de helpers, pero en el pool dado y esperando la barrera antes de llamar.
async function rpcEn(
  pool: pg.Pool,
  esperar: () => Promise<void>,
  userId: string,
  nombre: string,
  args: Record<string, unknown>,
) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ])
    await esperar()
    const keys = Object.keys(args)
    const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
    const r = await c.query(`select * from public.${nombre}(${params})`, keys.map((k) => args[k]))
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

// Lanza las dos llamadas en paralelo, una por conexión.
function enParalelo(
  a: [string, string, Record<string, unknown>],
  b: [string, string, Record<string, unknown>],
) {
  const esperar = barrera(2)
  return Promise.allSettled([rpcEn(pools[0], esperar, ...a), rpcEn(pools[1], esperar, ...b)])
}

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'San Luis Capital')
  let n = 0

  const tramite = async () => {
    n += 1
    const id = (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos 1.3', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    return id
  }

  const saldo = () =>
    comoUsuario(gerencia, async (c) => {
      const r = (await c.query(`select * from public.v_saldos where empresa = 'Paris Autos'`)).rows[0]
      return r.registrado_cents as bigint
    })

  return { gerencia, empresa, tramite, saldo }
}

const presupuestoArgs = (tramite: string, total: bigint) => ({
  p_tramite: tramite, p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n,
})

const pagoArgs = (idem: string, tramite: string, total: bigint) => ({
  p_idem: idem, p_tramite: tramite, p_fecha: FECHA,
  p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: false,
})

test('dos presupuestos simultáneos sobre una cuenta con fondos para uno: exactamente un trámite queda sin_fondos', async () => {
  const f = await preparar()
  await rpc(f.gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: f.empresa, p_importe: 1000000n, p_fecha: FECHA })
  const t1 = await f.tramite()
  const t2 = await f.tramite()

  const res = await enParalelo(
    [f.gerencia, 'registrar_presupuesto', presupuestoArgs(t1, 800000n)],
    [f.gerencia, 'registrar_presupuesto', presupuestoArgs(t2, 800000n)],
  )
  expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])

  const situaciones = await comoUsuario(f.gerencia, async (c) =>
    (
      await c.query(`select situacion from public.v_tramite_finanzas where tramite_id = any($1::uuid[])`, [[t1, t2]])
    ).rows.map((r) => r.situacion as string),
  )
  expect(situaciones.sort()).toEqual(['comprometido', 'sin_fondos'])
})

test('mismo idem_key de pago enviado en paralelo por dos conexiones crea un solo movimiento y ambas devuelven el mismo id', async () => {
  const f = await preparar()
  const t = await f.tramite()
  const idem = randomUUID()

  const res = await enParalelo(
    [f.gerencia, 'registrar_pago', pagoArgs(idem, t, 500000n)],
    [f.gerencia, 'registrar_pago', pagoArgs(idem, t, 500000n)],
  )
  expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
  const ids = res.map((r) => (r as PromiseFulfilledResult<pg.QueryResult>).value.rows[0].registrar_pago)
  expect(ids[0]).toBe(ids[1])

  const filas = await sqlAdmin(`select id from public.movimientos where idem_key = $1`, [idem])
  expect(filas.map((r) => r.id)).toEqual([ids[0]])
})

test('carga y pago simultáneos sobre la misma cuenta dejan el saldo exacto', async () => {
  const f = await preparar()
  const t = await f.tramite()
  const inicial = await f.saldo()

  const res = await enParalelo(
    [f.gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: f.empresa, p_importe: 1000000n, p_fecha: FECHA }],
    [f.gerencia, 'registrar_pago', pagoArgs(randomUUID(), t, 300000n)],
  )
  expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])

  expect(await f.saldo()).toBe(inicial + 1000000n - 300000n)
})

test('edición concurrente del mismo trámite: una gana y la otra recibe VERSION_CONFLICTO', async () => {
  const f = await preparar()
  const t = await f.tramite()
  const [{ version }] = await sqlAdmin(`select version from public.tramites where id = $1`, [t])

  const res = await enParalelo(
    [f.gerencia, 'cambiar_estado', { p_tramite: t, p_estado: 'en_gestoria', p_motivo: null, p_version: version }],
    [f.gerencia, 'cambiar_estado', { p_tramite: t, p_estado: 'suspendido', p_motivo: 'falta documentación', p_version: version }],
  )

  const ok = res.filter((r) => r.status === 'fulfilled')
  const fallos = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  expect(ok).toHaveLength(1)
  expect(fallos).toHaveLength(1)
  expect(String(fallos[0].reason.message)).toMatch(/^VERSION_CONFLICTO:/)

  const [fila] = await sqlAdmin(`select estado, version from public.tramites where id = $1`, [t])
  expect(fila.version).toBe(version + 1)
  expect(['en_gestoria', 'suspendido']).toContain(fila.estado)
})
