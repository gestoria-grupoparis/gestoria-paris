import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const crearTramite = async (userId: string, oferta = 'OF-555', dominio = 'AB123CD') => {
  const r = await rpc(userId, 'crear_tramite', {
    p_idem: randomUUID(),
    p_empresa: await idPorNombre('empresas', 'Paris Autos'),
    p_sucursal: await idPorNombre('sucursales', 'San Luis'),
    p_tipo: 'patentamiento_0km',
    p_cliente: 'Juan Pérez',
    p_cuenta_personal: 'CP-1001',
    p_oferta: oferta,
    p_vehiculo: 'Fiat Cronos 1.3',
    p_dominio: dominio,
  })
  return r.rows[0].crear_tramite as string
}

const tramite = async (id: string) =>
  (await sqlAdmin(`select * from public.tramites where id = $1`, [id]))[0]
const operacion = async (id: string) =>
  (await sqlAdmin(`select * from public.operaciones where id = $1`, [id]))[0]

type Datos = Partial<{
  cliente: string
  cuenta: string
  oferta: string
  vehiculo: string
  dominio: string | null
  chasis: string | null
  motivo: string | null
}>

const editar = (userId: string, id: string, version: number, d: Datos = {}) =>
  rpc(userId, 'editar_tramite', {
    p_tramite: id,
    p_version: version,
    p_cliente: d.cliente ?? 'Juan Pérez',
    p_cuenta_personal: d.cuenta ?? 'CP-1001',
    p_oferta: d.oferta ?? 'OF-555',
    p_vehiculo: d.vehiculo ?? 'Fiat Cronos 1.3',
    p_dominio: d.dominio === undefined ? 'AB123CD' : d.dominio,
    p_chasis: d.chasis ?? null,
    p_motivo: d.motivo ?? null,
  })

test('contable corrige cliente, vehículo y dominio de un borrador e incrementa la versión', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  await editar(contable, id, 1, {
    cliente: 'Juan M. Pérez',
    cuenta: 'CP-1002',
    vehiculo: 'Fiat Cronos 1.3 Drive',
    dominio: ' ac456de ',
    motivo: 'error de tipeo',
  })

  const t = await tramite(id)
  expect(t).toMatchObject({ version: 2, vehiculo_desc: 'Fiat Cronos 1.3 Drive', dominio: 'AC456DE' })
  expect(await operacion(t.operacion_id)).toMatchObject({
    cliente_nombre: 'Juan M. Pérez',
    cuenta_personal: 'CP-1002',
  })
  const [ev] = await sqlAdmin(
    `select actor_id, motivo from public.eventos where entidad = 'tramites' and accion = 'update'`,
  )
  expect(ev).toEqual({ actor_id: contable, motivo: 'error de tipeo' })
})

test('cambiar la oferta mueve el trámite a la operación de esa oferta', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  const original = (await tramite(id)).operacion_id

  await editar(contable, id, 1, { oferta: 'OF-777' })

  const t = await tramite(id)
  expect(t.operacion_id).not.toBe(original)
  expect((await operacion(t.operacion_id)).oferta_ref).toBe('OF-777')
})

test('un observado se edita y vuelve a borrador', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await rpc(contable, 'cambiar_estado', { p_tramite: id, p_estado: 'observado', p_motivo: 'dominio mal', p_version: 1 })

  await editar(contable, id, 2, { dominio: 'AA111AA' })
  await rpc(contable, 'cambiar_estado', { p_tramite: id, p_estado: 'borrador', p_motivo: null, p_version: 3 })

  expect(await tramite(id)).toMatchObject({ estado: 'borrador', dominio: 'AA111AA', version: 4 })
})

test('versión vieja da VERSION_CONFLICTO y no cambia nada', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await editar(contable, id, 1, { vehiculo: 'Otro' })

  await expect(editar(contable, id, 1, { vehiculo: 'Pisado' })).rejects.toThrow(/^VERSION_CONFLICTO:/)
  expect((await tramite(id)).vehiculo_desc).toBe('Otro')
})

test('un trámite autorizado no se edita (TRANSICION_INVALIDA)', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await rpc(contable, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })

  await expect(editar(contable, id, 2, { vehiculo: 'X' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
})

test('gestora o contable sin alcance reciben SIN_PERMISO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const ajeno = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const id = await crearTramite(contable)

  await expect(editar(gestora, id, 1)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(editar(ajeno, id, 1)).rejects.toThrow(/^SIN_PERMISO:/)
})

test('datos vacíos dan DATO_INVALIDO y chocar con otro trámite vivo da DUPLICADO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  await crearTramite(contable, 'OF-555', 'AB123CD')
  const otro = await crearTramite(contable, 'OF-555', 'ZZ999ZZ')

  await expect(editar(contable, otro, 1, { cliente: '  ' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(editar(contable, otro, 1, { dominio: 'ab123cd' })).rejects.toThrow(/^DUPLICADO:/)
  expect((await tramite(otro)).dominio).toBe('ZZ999ZZ')
})
