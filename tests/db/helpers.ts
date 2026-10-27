import pg from 'pg'
import type { PoolClient } from 'pg'
// @ts-expect-error módulo ESM sin tipos
import { resetDb as resetDbScript, TEST_DB_URL } from '../../scripts/test-db.mjs'

// int8 se devuelve como bigint de JS (los importes en centimos dependen de ello)
pg.types.setTypeParser(20, BigInt)

export type Rol = string

const url: string = process.env.TEST_DB_URL ?? TEST_DB_URL
let pool: pg.Pool | undefined
const getPool = () => (pool ??= new pg.Pool({ connectionString: url, max: 4 }))

export async function resetDb(): Promise<void> {
  await resetDbScript(url)
}

// En esta tarea solo inserta en auth.users; la Tarea 2 la extiende con perfiles/alcances.
export async function crearUsuario(
  _rol: Rol,
  _alcances: { empresa: string; sucursal?: string }[],
): Promise<string> {
  const r = await getPool().query(
    `insert into auth.users (email) values ($1) returning id`,
    [`u${Math.random().toString(36).slice(2)}@test.local`],
  )
  return r.rows[0].id
}

export async function comoUsuario<T>(
  userId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await getPool().connect()
  try {
    await c.query('begin')
    await c.query('set local role authenticated')
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' })
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    const res = await fn(c)
    await c.query('commit')
    return res
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export async function rpc(userId: string, nombre: string, args: Record<string, unknown> = {}) {
  const keys = Object.keys(args)
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return comoUsuario(userId, (c) =>
    c.query(`select * from public.${nombre}(${params})`, keys.map((k) => args[k])),
  )
}

export async function cerrarPool() {
  await pool?.end()
  pool = undefined
}
