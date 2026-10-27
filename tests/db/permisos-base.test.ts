import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, sqlAdmin } from './helpers'

beforeEach(resetDb)

const miRol = (userId: string) =>
  comoUsuario(userId, (c) => c.query('select public.mi_rol() as r').then((r) => r.rows[0].r as string | null))

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const tieneAlcance = async (userId: string, empresa: string, sucursal: string) => {
  const args = [await idPorNombre('empresas', empresa), await idPorNombre('sucursales', sucursal)]
  return comoUsuario(userId, (c) =>
    c.query('select public.tiene_alcance($1, $2) as ok', args).then((r) => r.rows[0].ok as boolean),
  )
}

test('mi_rol devuelve el rol del usuario y null si está inactivo', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Cars', sucursal: 'San Juan' }])

  expect(await miRol(gestora)).toBe('gestora')
  expect(await miRol(contable)).toBe('contable')

  await sqlAdmin('update public.perfiles set activo = false where id = $1', [gestora])

  expect(await miRol(gestora)).toBeNull()
  expect(await miRol(contable)).toBe('contable')
})

test('tiene_alcance con sucursal null habilita todas las sucursales de esa empresa', async () => {
  const todas = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const soloSanLuis = await crearUsuario('comercial', [{ empresa: 'Paris Autos', sucursal: 'San Luis' }])

  expect(await tieneAlcance(todas, 'Paris Autos', 'San Luis')).toBe(true)
  expect(await tieneAlcance(todas, 'Paris Autos', 'San Juan')).toBe(true)
  expect(await tieneAlcance(soloSanLuis, 'Paris Autos', 'San Luis')).toBe(true)
  expect(await tieneAlcance(soloSanLuis, 'Paris Autos', 'San Juan')).toBe(false)
})

test('tiene_alcance es false para otra empresa', async () => {
  const id = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])

  expect(await tieneAlcance(id, 'Paris Autos', 'San Luis')).toBe(true)
  expect(await tieneAlcance(id, 'Paris Cars', 'San Luis')).toBe(false)
  expect(await tieneAlcance(id, 'Paris Motor', 'San Juan')).toBe(false)
})

test('el seed crea Paris Autos, Paris Cars y Paris Motor', async () => {
  const empresas = await sqlAdmin('select nombre from public.empresas order by nombre')
  expect(empresas.map((r) => r.nombre)).toEqual(['Paris Autos', 'Paris Cars', 'Paris Motor'])

  const sucursales = await sqlAdmin('select nombre, provincia from public.sucursales order by nombre')
  expect(sucursales).toEqual([
    { nombre: 'San Juan', provincia: 'San Juan' },
    { nombre: 'San Luis', provincia: 'San Luis' },
  ])

  const tipos = await sqlAdmin('select codigo, activo from public.tipos_tramite order by codigo')
  expect(tipos).toEqual([
    { codigo: 'patentamiento_0km', activo: true },
    { codigo: 'transferencia_parte_pago', activo: true },
    { codigo: 'transferencia_usado', activo: true },
  ])
})
