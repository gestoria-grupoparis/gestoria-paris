import { readFileSync } from 'node:fs'
import pg from 'pg'
import { beforeEach, expect, test } from 'vitest'
// @ts-expect-error módulo ESM sin tipos
import { ADMIN_URL, aplicarEsquema, listarMigracionesCatalogo, urlDeBase } from '../../scripts/test-db.mjs'
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

const CATALOGOS = {
  empresas: ['Paris Autos', 'Paris Cars', 'Paris Motor'],
  sucursales: [
    { nombre: 'San Juan', provincia: 'San Juan' },
    { nombre: 'San Luis', provincia: 'San Luis' },
  ],
  tipos: ['patentamiento_0km', 'transferencia_parte_pago', 'transferencia_usado'],
  cuentas: ['Habitualista Paris Autos', 'Habitualista Paris Cars', 'Habitualista Paris Motor'],
}

const leerCatalogos = async (q: (sql: string) => Promise<Record<string, unknown>[]>) => ({
  empresas: (await q('select nombre from public.empresas order by nombre')).map((r) => r.nombre),
  sucursales: await q('select nombre, provincia from public.sucursales order by nombre'),
  tipos: (await q('select codigo from public.tipos_tramite order by codigo')).map((r) => r.codigo),
  cuentas: (
    await q(`select c.nombre from public.cuentas c
               join public.empresas e on e.id = c.empresa_id and c.nombre = 'Habitualista ' || e.nombre
              order by c.nombre`)
  ).map((r) => r.nombre),
})

// `supabase db push` aplica solo migraciones: los catálogos tienen que existir sin seed.sql.
test('las migraciones solas (sin seed) crean los catálogos y son idempotentes', async () => {
  const nombre = 'gestoria_sin_seed'
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    await admin.query(`drop database if exists ${nombre} with (force)`)
    await admin.query(`create database ${nombre}`)
    const c = new pg.Client({ connectionString: urlDeBase(nombre) })
    await c.connect()
    try {
      await aplicarEsquema(c)
      const q = (sql: string) => c.query(sql).then((r) => r.rows)
      expect(await leerCatalogos(q)).toEqual(CATALOGOS)

      // Re-ejecutar la migración de catálogos no duplica filas.
      for (const f of listarMigracionesCatalogo() as string[]) await c.query(readFileSync(f, 'utf8'))
      expect(await leerCatalogos(q)).toEqual(CATALOGOS)
    } finally {
      await c.end()
    }
  } finally {
    await admin.query(`drop database if exists ${nombre} with (force)`)
    await admin.end()
  }
})

test('sucursales no admite dos filas con el mismo nombre y provincia', async () => {
  await expect(
    sqlAdmin(`insert into public.sucursales (nombre, provincia) values ('San Luis', 'San Luis')`),
  ).rejects.toThrow(/duplicate key/)
})

test('los catálogos iniciales incluyen Paris Autos, Paris Cars y Paris Motor', async () => {
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
