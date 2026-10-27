import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

// Año calendario en la zona de negocio, para el número visible T-<año>-<correlativo>.
const anioAR = () =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date())

type Alta = {
  idem?: string
  empresa?: string
  sucursal?: string
  tipo?: string
  oferta?: string
  dominio?: string | null
}

const crearTramite = async (userId: string, a: Alta = {}) => {
  const args = {
    p_idem: a.idem ?? randomUUID(),
    p_empresa: await idPorNombre('empresas', a.empresa ?? 'Paris Autos'),
    p_sucursal: await idPorNombre('sucursales', a.sucursal ?? 'San Luis'),
    p_tipo: a.tipo ?? 'patentamiento_0km',
    p_cliente: 'Juan Pérez',
    p_cuenta_personal: 'CP-1001',
    p_oferta: a.oferta ?? 'OF-555',
    p_vehiculo: 'Fiat Cronos 1.3',
    p_dominio: a.dominio === undefined ? 'AB123CD' : a.dominio,
  }
  const r = await rpc(userId, 'crear_tramite', args)
  return r.rows[0].crear_tramite as string
}

const tramite = async (id: string) =>
  (await sqlAdmin(`select * from public.tramites where id = $1`, [id]))[0]

test('contable crea un trámite en borrador con número T-2026-00001', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])

  const id = await crearTramite(contable, { dominio: 'ab123cd' })

  const t = await tramite(id)
  expect(t.numero).toBe(`T-${anioAR()}-00001`)
  expect(t.estado).toBe('borrador')
  expect(t.version).toBe(1)
  expect(t.creado_por).toBe(contable)
  expect(t.dominio).toBe('AB123CD')
  expect(t.empresa_id).toBe(await idPorNombre('empresas', 'Paris Autos'))
  expect(t.sucursal_id).toBe(await idPorNombre('sucursales', 'San Luis'))

  const [op] = await sqlAdmin(`select * from public.operaciones where id = $1`, [t.operacion_id])
  expect(op).toMatchObject({
    empresa_id: t.empresa_id,
    sucursal_id: t.sucursal_id,
    cliente_nombre: 'Juan Pérez',
    cuenta_personal: 'CP-1001',
    oferta_ref: 'OF-555',
  })

  // El alta queda auditada con actor y motivo.
  const eventos = await sqlAdmin(
    `select entidad, actor_id, motivo from public.eventos
      where entidad in ('operaciones', 'tramites') and accion = 'insert' order by id`,
  )
  expect(eventos).toEqual([
    { entidad: 'operaciones', actor_id: contable, motivo: 'alta de trámite' },
    { entidad: 'tramites', actor_id: contable, motivo: 'alta de trámite' },
  ])
})

test('mismo idem_key devuelve el mismo id y no crea otro', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const idem = randomUUID()

  const primero = await crearTramite(contable, { idem })
  const segundo = await crearTramite(contable, { idem })

  expect(segundo).toBe(primero)
  const [{ n }] = await sqlAdmin('select count(*)::int as n from public.tramites')
  expect(n).toBe(1)

  // Doble clic: dos envíos simultáneos con la misma clave crean uno solo.
  const otra = randomUUID()
  const [x, y] = await Promise.all([
    crearTramite(contable, { idem: otra, oferta: 'OF-777' }),
    crearTramite(contable, { idem: otra, oferta: 'OF-777' }),
  ])
  expect(y).toBe(x)
  const [{ n: total }] = await sqlAdmin('select count(*)::int as n from public.tramites')
  expect(total).toBe(2)
})

test('la empresa y sucursal del trámite son las de su operación', async () => {
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(gerente, { sucursal: 'San Luis' })

  // La misma oferta no puede reaparecer en otra sucursal.
  await expect(
    crearTramite(gerente, { sucursal: 'San Juan', tipo: 'transferencia_usado' }),
  ).rejects.toThrow(/^DATO_INVALIDO:/)

  // Ni siquiera el dueño de la tabla puede desalinear la copia.
  const sanJuan = await idPorNombre('sucursales', 'San Juan')
  await expect(
    sqlAdmin(`update public.tramites set sucursal_id = $1 where id = $2`, [sanJuan, id]),
  ).rejects.toThrow(/foreign key/)
})

test('misma operación + tipo + dominio da DUPLICADO; con otro tipo crea un segundo trámite en la misma operación', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])

  const primero = await crearTramite(contable, { tipo: 'transferencia_usado' })
  await expect(crearTramite(contable, { tipo: 'transferencia_usado', dominio: 'ab123cd' })).rejects.toThrow(
    `DUPLICADO: ya existe T-${anioAR()}-00001`,
  )

  const segundo = await crearTramite(contable, { tipo: 'transferencia_parte_pago' })

  expect(segundo).not.toBe(primero)
  const [a, b] = [await tramite(primero), await tramite(segundo)]
  expect(b.operacion_id).toBe(a.operacion_id)
  const [{ n }] = await sqlAdmin('select count(*)::int as n from public.operaciones')
  expect(n).toBe(1)
})

test('gestora no puede crear trámites (SIN_PERMISO)', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])

  await expect(crearTramite(gestora)).rejects.toThrow(/^SIN_PERMISO:/)

  const [{ n }] = await sqlAdmin('select count(*)::int as n from public.tramites')
  expect(n).toBe(0)
})

test('contable sin alcance en Paris Cars no puede crear en Paris Cars', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])

  await expect(crearTramite(contable, { empresa: 'Paris Cars' })).rejects.toThrow(/^SIN_PERMISO:/)

  const [{ n }] = await sqlAdmin('select count(*)::int as n from public.operaciones')
  expect(n).toBe(0)
})

test('trámite cancelado no bloquea un nuevo alta igual', async () => {
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])

  const primero = await crearTramite(gerente)
  await sqlAdmin(`update public.tramites set estado = 'cancelado' where id = $1`, [primero])

  const segundo = await crearTramite(gerente)

  expect(segundo).not.toBe(primero)
  expect((await tramite(segundo)).numero).toBe(`T-${anioAR()}-00002`)
})

test('buscar_duplicados lista los trámites activos con la misma oferta o dominio en la empresa', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const mismaOferta = await crearTramite(contable, { oferta: 'OF-1', dominio: 'AA111AA' })
  const mismoDominio = await crearTramite(contable, { oferta: 'OF-2', dominio: 'BB222BB' })
  const cancelado = await crearTramite(contable, { oferta: 'OF-1', tipo: 'transferencia_usado', dominio: 'CC333CC' })
  await crearTramite(contable, { oferta: 'OF-3', dominio: 'DD444DD' })
  await sqlAdmin(`update public.tramites set estado = 'cancelado' where id = $1`, [cancelado])

  const r = await rpc(contable, 'buscar_duplicados', {
    p_empresa: await idPorNombre('empresas', 'Paris Autos'),
    p_oferta: 'OF-1',
    p_dominio: 'bb222bb',
  })

  expect(r.rows.map((x) => x.id).sort()).toEqual([mismaOferta, mismoDominio].sort())
  expect(r.rows.every((x) => x.estado === 'borrador' && /^T-\d{4}-\d{5}$/.test(x.numero))).toBe(true)
})
