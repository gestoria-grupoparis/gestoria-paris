import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const ajena = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'San Luis Capital')
  let n = 0
  const crear = async (por = contable) => {
    n += 1
    return (
      await rpc(por, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Fiat Cronos 1.3', p_dominio: 'AA' + n + 'BB',
      })
    ).rows[0].crear_tramite as string
  }
  const mias = (perfil: string) =>
    comoUsuario(perfil, async (c) =>
      (await c.query(`select tipo, tramite_id, leida_at from public.notificaciones order by created_at, tipo`)).rows,
    )
  return { gerencia, contable, ajena, gestora, empresa, crear, mias }
}

test('autorizar con gestora le avisa a la gestora (asignado)', async () => {
  const { gerencia, gestora, crear, mias } = await preparar()
  const t = await crear()
  expect(await mias(gestora)).toEqual([])
  await rpc(gerencia, 'autorizar_tramite', { p_tramite: t, p_gestora: gestora, p_version: 1 })
  const n = await mias(gestora)
  expect(n).toHaveLength(1)
  expect(n[0]).toMatchObject({ tipo: 'asignado', tramite_id: t, leida_at: null })
})

test('observar un trámite avisa a quien lo creó, no a quien lo observa', async () => {
  const { gerencia, contable, crear, mias } = await preparar()
  const t = await crear(contable)
  await rpc(gerencia, 'cambiar_estado', { p_tramite: t, p_estado: 'observado', p_motivo: 'falta DNI', p_version: 1 })
  expect((await mias(contable)).map((x) => x.tipo)).toEqual(['observado'])
  expect(await mias(gerencia)).toEqual([])
})

test('presupuesto cargado avisa a gerencia con alcance; sin fondos avisa a gestora y gerencia', async () => {
  const { gerencia, contable, ajena, gestora, crear, mias } = await preparar()
  const t = await crear()
  await rpc(gerencia, 'autorizar_tramite', { p_tramite: t, p_gestora: gestora, p_version: 1 })
  // Cuenta sin cargas: el presupuesto deja el trámite sin fondos.
  await rpc(contable, 'registrar_presupuesto', {
    p_tramite: t, p_arancel: 100000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: null,
  })
  expect((await mias(gerencia)).map((x) => x.tipo).sort()).toEqual(['presupuesto_cargado', 'sin_fondos'])
  expect((await mias(gestora)).map((x) => x.tipo)).toEqual(['asignado', 'sin_fondos'])
  expect(await mias(contable)).toEqual([]) // quien lo cargó no se avisa a sí mismo
  expect(await mias(ajena)).toEqual([])
})

test('cada uno ve solo las suyas, marca leídas por RPC y no puede escribir directo', async () => {
  const { gerencia, gestora, crear, mias } = await preparar()
  const t = await crear()
  await rpc(gerencia, 'autorizar_tramite', { p_tramite: t, p_gestora: gestora, p_version: 1 })
  const [{ id }] = await sqlAdmin(`select id from public.notificaciones where perfil_id = $1`, [gestora])
  // Gerencia no puede marcar la de la gestora
  const r0 = await rpc(gerencia, 'marcar_notificaciones_leidas', { p_ids: [id] })
  expect(r0.rows[0].marcar_notificaciones_leidas).toBe(0)
  const r1 = await rpc(gestora, 'marcar_notificaciones_leidas', { p_ids: null })
  expect(r1.rows[0].marcar_notificaciones_leidas).toBe(1)
  expect((await mias(gestora))[0].leida_at).not.toBeNull()
  await expect(
    comoUsuario(gestora, (c) => c.query(`update public.notificaciones set leida_at = null`)),
  ).rejects.toThrow()
  await expect(
    comoUsuario(gestora, (c) =>
      c.query(`insert into public.notificaciones (perfil_id, tipo, mensaje) values ($1, 'asignado', 'x')`, [gestora]),
    ),
  ).rejects.toThrow()
})
