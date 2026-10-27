import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const FECHA = '2026-10-27'

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

// Escenario: gerencia de todo el grupo; dos gestoras; trámites en Paris Autos/San Luis y Paris Cars/San Luis.
async function preparar() {
  const gerencia = await crearUsuario('gerencia', [
    { empresa: 'Paris Autos' }, { empresa: 'Paris Cars' }, { empresa: 'Paris Motor' },
  ])
  const gestora = await crearUsuario('gestora', [])
  const otraGestora = await crearUsuario('gestora', [])
  const autos = await idPorNombre('empresas', 'Paris Autos')
  const cars = await idPorNombre('empresas', 'Paris Cars')
  const sanLuis = await idPorNombre('sucursales', 'San Luis')
  let n = 0

  const crear = async (empresa: string) => {
    n += 1
    return (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sanLuis, p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos 1.3', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
  }
  const autorizar = async (tramite: string, g: string) => {
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: tramite, p_gestora: g, p_version: 1 })
    await rpc(gerencia, 'registrar_presupuesto', {
      p_tramite: tramite, p_arancel: 5000000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: null,
    })
    return tramite
  }

  await rpc(gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: autos, p_importe: 100000000n, p_fecha: FECHA })
  const propio = await autorizar(await crear(autos), gestora)
  const ajeno = await autorizar(await crear(autos), otraGestora)
  const borrador = await crear(autos)
  const deCars = await autorizar(await crear(cars), otraGestora)
  // La gestora registra un pago en su trámite; gerencia paga en el ajeno.
  await rpc(gestora, 'registrar_pago', {
    p_idem: randomUUID(), p_tramite: propio, p_fecha: FECHA,
    p_arancel: 1000000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: false,
  })
  await rpc(gerencia, 'registrar_pago', {
    p_idem: randomUUID(), p_tramite: ajeno, p_fecha: FECHA,
    p_arancel: 2000000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: false,
  })
  return { gerencia, gestora, otraGestora, autos, cars, sanLuis, propio, ajeno, borrador, deCars }
}

const filas = (userId: string, sql: string, params: unknown[] = []) =>
  comoUsuario(userId, async (c) => (await c.query(sql, params)).rows)

test('gestora: select de tramites ajenos devuelve 0 filas', async () => {
  const f = await preparar()

  expect(await filas(f.gestora, 'select id from public.tramites where id = any($1)', [[f.ajeno, f.borrador, f.deCars]]))
    .toEqual([])
  expect((await filas(f.gestora, 'select id from public.tramites')).map((r) => r.id)).toEqual([f.propio])
  // Un borrador asignado tampoco se ve.
  await sqlAdmin('update public.tramites set gestora_id = $1 where id = $2', [f.gestora, f.borrador])
  expect((await filas(f.gestora, 'select id from public.tramites')).map((r) => r.id)).toEqual([f.propio])

  // Tablas hijas: operaciones, marcas, presupuestos siguen la misma visibilidad.
  expect((await filas(f.gestora, 'select tramite_id from public.presupuestos')).map((r) => r.tramite_id)).toEqual([f.propio])
  expect((await filas(f.gestora, 'select id from public.operaciones')).length).toBe(1)
  // Movimientos: solo sus propios pagos; cuentas y excepciones: nada.
  const movs = await filas(f.gestora, 'select tramite_id, creado_por, importe_cents from public.movimientos')
  expect(movs).toEqual([{ tramite_id: f.propio, creado_por: f.gestora, importe_cents: -1000000n }])
  expect(await filas(f.gestora, 'select * from public.cuentas')).toEqual([])
  expect(await filas(f.gestora, 'select * from public.excepciones_fondos')).toEqual([])
  // Eventos: solo de trámites que puede ver.
  const ev = await filas(f.gestora, `select distinct entidad_id from public.eventos where entidad = 'tramites'`)
  expect(ev.map((r) => r.entidad_id)).toEqual([f.propio])
  // Perfiles: solo el suyo.
  expect((await filas(f.gestora, 'select id from public.perfiles')).map((r) => r.id)).toEqual([f.gestora])
})

test.each([
  ['tramites', `insert into public.tramites (numero) values ('X')`],
  ['movimientos', `insert into public.movimientos (cuenta_id) values (gen_random_uuid())`],
  ['presupuestos', `insert into public.presupuestos (tramite_id) values (gen_random_uuid())`],
  ['eventos', `insert into public.eventos (entidad, accion) values ('x', 'insert')`],
  ['perfiles', `insert into public.perfiles (id, nombre, rol) values (gen_random_uuid(), 'x', 'admin')`],
  ['tramites (update)', `update public.tramites set estado = 'cerrado'`],
  ['movimientos (delete)', `delete from public.movimientos`],
])('gestora: insert directo en movimientos falla con permission denied — %s', async (_t, sql) => {
  const f = await preparar()
  await expect(comoUsuario(f.gestora, (c) => c.query(sql))).rejects.toThrow(/permission denied/)
})

test.each([
  ['autorizar_tramite', (f: Awaited<ReturnType<typeof preparar>>) =>
    ({ p_tramite: f.borrador, p_gestora: f.gestora, p_version: 1 })],
  ['registrar_ajuste', (f: Awaited<ReturnType<typeof preparar>>) =>
    ({ p_idem: randomUUID(), p_empresa: f.autos, p_importe: 100n, p_fecha: FECHA, p_motivo: 'ajuste' })],
  ['registrar_carga', (f: Awaited<ReturnType<typeof preparar>>) =>
    ({ p_idem: randomUUID(), p_empresa: f.autos, p_importe: 100n, p_fecha: FECHA })],
  ['aprobar_excepcion_fondos', (f: Awaited<ReturnType<typeof preparar>>) =>
    ({ p_tramite: f.propio, p_motivo: 'urgente' })],
])('gestora: autorizar, registrar_ajuste, registrar_carga, aprobar_excepcion_fondos dan SIN_PERMISO — %s', async (nombre, args) => {
  const f = await preparar()
  await expect(rpc(f.gestora, nombre, args(f))).rejects.toThrow(/^SIN_PERMISO: /)
})

test('gestora: v_saldos devuelve 0 filas; v_tramite_finanzas solo sus trámites con situacion visible', async () => {
  const f = await preparar()

  expect(await filas(f.gestora, 'select * from public.v_saldos')).toEqual([])
  const fin = await filas(f.gestora, 'select tramite_id, situacion from public.v_tramite_finanzas')
  expect(fin).toEqual([{ tramite_id: f.propio, situacion: 'pagado_parcial' }])
})

test('contable con alcance San Luis/Paris Autos no ve trámites de Paris Cars', async () => {
  const f = await preparar()
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos', sucursal: 'San Luis' }])

  const ids = (await filas(contable, 'select id from public.tramites order by numero')).map((r) => r.id)
  expect(ids).toEqual([f.propio, f.ajeno, f.borrador])
  expect(await filas(contable, 'select id from public.tramites where empresa_id = $1', [f.cars])).toEqual([])
  expect(await filas(contable, 'select * from public.v_tramite_finanzas where empresa_id = $1', [f.cars])).toEqual([])
  expect(await filas(contable, 'select * from public.cuentas where empresa_id = $1', [f.cars])).toEqual([])
  expect((await filas(contable, 'select tramite_id from public.presupuestos')).map((r) => r.tramite_id).sort())
    .toEqual([f.propio, f.ajeno].sort())
  // Perfiles: contable ve todos.
  expect((await filas(contable, 'select id from public.perfiles')).length).toBe(4)
})

test('anon no puede ejecutar ninguna RPC', async () => {
  const sinPermiso = await sqlAdmin(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)
  expect(sinPermiso).toEqual([])
  const tablas = await sqlAdmin(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v')
       and has_table_privilege('anon', c.oid, 'select, insert, update, delete')`)
  expect(tablas).toEqual([])
  // Funciones internas tampoco las ejecuta authenticated.
  const internas = await sqlAdmin(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
       and p.proname in ('insertar_movimiento', 'movimiento_por_idem', 'siguiente_numero_tramite',
                         'bloquear_cuenta_empresa', 'es_gestora_activa', 'auditar')`)
  expect(internas).toEqual([])
  // Y una llamada real como anon falla.
  await expect(sqlAdmin(`do $$ begin
      set local role anon;
      perform public.registrar_carga(gen_random_uuid(), gen_random_uuid(), 1, current_date);
    end $$`)).rejects.toThrow(/permission denied for function registrar_carga/)
})

test('nadie puede update en eventos', async () => {
  const f = await preparar()
  for (const u of [f.gerencia, f.gestora]) {
    await expect(comoUsuario(u, (c) => c.query(`update public.eventos set motivo = 'x'`))).rejects.toThrow(/permission denied/)
  }
  await expect(sqlAdmin(`update public.eventos set motivo = 'x'`)).rejects.toThrow()
  await expect(sqlAdmin(`delete from public.eventos`)).rejects.toThrow()
})
