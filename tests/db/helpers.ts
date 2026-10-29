import pg from 'pg'
import type { PoolClient } from 'pg'
// @ts-expect-error módulo ESM sin tipos
import { resetDb as resetDbScript, TEST_DB_URL } from '../../scripts/test-db.mjs'

// int8 se devuelve como bigint de JS (los importes en centimos dependen de ello)
pg.types.setTypeParser(20, BigInt)

export type Rol = 'gerencia' | 'contable' | 'gestora' | 'comercial' | 'admin'
export type Alcance = { empresa: string; sucursal?: string }

const url: string = process.env.TEST_DB_URL ?? TEST_DB_URL
let pool: pg.Pool | undefined
const getPool = () => (pool ??= new pg.Pool({ connectionString: url, max: 4 }))

export async function resetDb(): Promise<void> {
  await resetDbScript(url)
}

// Consulta directa como dueño de las tablas (sin rol authenticated), para preparar datos y verificar.
export async function sqlAdmin(sql: string, params: unknown[] = []) {
  return (await getPool().query(sql, params)).rows
}

// Crea auth.users + perfil activo con el rol dado + sus alcances (nombres resueltos contra el seed).
// Sin sucursal => sucursal_id null (todas las sucursales de esa empresa).
export async function crearUsuario(rol: Rol, alcances: Alcance[]): Promise<string> {
  const c = await getPool().connect()
  try {
    await c.query('begin')
    const corto = Math.random().toString(36).slice(2, 8)
    const id: string = (
      await c.query(`insert into auth.users (email) values ($1) returning id`, [`${rol}-${corto}@test.local`])
    ).rows[0].id
    await c.query(`insert into public.perfiles (id, nombre, rol) values ($1, $2, $3)`, [id, `${rol} ${corto}`, rol])
    for (const a of alcances) {
      const r = await c.query(
        `insert into public.alcances (perfil_id, empresa_id, sucursal_id)
         select $1, e.id, s.id
           from public.empresas e
           left join public.sucursales s on s.nombre = $3
          where e.nombre = $2 and ($3::text is null or s.id is not null)`,
        [id, a.empresa, a.sucursal ?? null],
      )
      if (r.rowCount !== 1) throw new Error(`Alcance inexistente en el seed: ${JSON.stringify(a)}`)
    }
    await c.query('commit')
    return id
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
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

// Deja el trámite listo para que la gestora lo presente (ping pong): presupuesto vigente
// aprobado y legajo retirado. Si no tiene presupuesto, carga uno mínimo. Va directo por SQL
// porque los tests que lo usan prueban estados, no fondos.
export async function habilitarPresentacion(tramite: string, por: string): Promise<void> {
  // El legajo lo retira la gestora asignada.
  const [{ gestora_id: gestora }] = await sqlAdmin('select gestora_id from public.tramites where id = $1', [tramite])
  await sqlAdmin(
    `insert into public.presupuestos (tramite_id, version, arancel_cents, creado_por)
     select $1, 1, 1000, $2 where not exists (select 1 from public.presupuestos where tramite_id = $1)`,
    [tramite, por],
  )
  await sqlAdmin(
    `insert into public.aprobaciones_presupuesto (tramite_id, version, aprobado_por)
     select $1, max(version), $2 from public.presupuestos where tramite_id = $1
     on conflict do nothing`,
    [tramite, por],
  )
  await sqlAdmin(
    `insert into public.tramite_marcas (tramite_id, marca, por) values ($1, 'retirado', $2) on conflict do nothing`,
    [tramite, gestora],
  )
}
