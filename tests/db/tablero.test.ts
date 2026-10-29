import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, habilitarPresentacion, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

test('resumen_tablero cuenta por razón social y etapa, respetando el alcance', async () => {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }, { empresa: 'Doral' }])
  const ajena = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'Villa Mercedes')
  const crear = async (n: number) => {
    const id = (
      await rpc(gerencia, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'transferencia_usado',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Peugeot 208', p_dominio: 'AB' + n + 'CD',
      })
    ).rows[0].crear_tramite as string
    await rpc(gerencia, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    return id
  }
  const presupuestar = (id: string) =>
    sqlAdmin(`insert into public.presupuestos (tramite_id, version, arancel_cents, creado_por) values ($1, 1, 1000, $2)`, [id, gestora])

  await presupuestar(await crear(1))
  await presupuestar(await crear(2))
  await habilitarPresentacion(await crear(3), gerencia)
  await crear(4)

  const futuro = '2100-01-01T00:00:00Z'
  const filas = (await rpc(gerencia, 'resumen_tablero', { p_corte: futuro })).rows
  expect(filas.map((f) => f.empresa)).toEqual(['Doral', 'Paris Autos'])
  const pa = filas.find((f) => f.empresa === 'Paris Autos')!
  expect(pa).toMatchObject({ abiertos: 4, por_aprobar: 2, listos: 1, presentados: 0, demorados: 4 })
  expect(filas.find((f) => f.empresa === 'Doral')).toMatchObject({ abiertos: 0, por_aprobar: 0 })

  const ajenas = (await rpc(ajena, 'resumen_tablero', { p_corte: futuro })).rows
  expect(ajenas.map((f) => f.empresa)).toEqual(['Paris Cars'])

  const interv = (await rpc(gerencia, 'tramites_intervencion', { p_corte: '2000-01-01T00:00:00Z' })).rows
  expect(interv.filter((t) => t.motivos.includes('por_aprobar'))).toHaveLength(2)
  expect((await rpc(ajena, 'tramites_intervencion', { p_corte: futuro })).rows).toEqual([])
})
