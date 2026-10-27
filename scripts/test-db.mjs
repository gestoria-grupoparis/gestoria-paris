import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

pg.types.setTypeParser(20, BigInt)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 54329
const DB = 'gestoria_test'
const USER = 'postgres'
const PASSWORD = 'postgres'
const DATA_DIR = join(ROOT, '.pgtest')

export const TEST_DB_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`
const ADMIN_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres`

const leer = (ruta) => readFileSync(ruta, 'utf8')

export function listarMigraciones() {
  const dir = join(ROOT, 'supabase', 'migrations')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f))
}

const rutaSeed = () => join(ROOT, 'supabase', 'seed.sql')

async function aplicarSeed(client) {
  if (existsSync(rutaSeed())) await client.query(leer(rutaSeed()))
}

export async function startDb() {
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  })
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) await server.initialise()
  await server.start()

  try {
    const admin = new pg.Client({ connectionString: ADMIN_URL })
    await admin.connect()
    try {
      await admin.query(`drop database if exists ${DB} with (force)`)
      await admin.query(`create database ${DB}`)
    } finally {
      await admin.end()
    }

    const client = new pg.Client({ connectionString: TEST_DB_URL })
    await client.connect()
    try {
      await client.query(leer(join(ROOT, 'db', 'test-support', 'auth_stub.sql')))
      for (const f of listarMigraciones()) await client.query(leer(f))
      await aplicarSeed(client)
    } finally {
      await client.end()
    }
  } catch (e) {
    await server.stop().catch(() => {})
    throw e
  }

  return {
    url: TEST_DB_URL,
    async stop() {
      await server.stop()
    },
  }
}

// Vacia todas las tablas de public y auth.users, reinicia todas las secuencias de public y reaplica el seed.
export async function resetDb(url = TEST_DB_URL) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(`
      do $$
      declare r record;
      begin
        for r in select quote_ident(schemaname) || '.' || quote_ident(tablename) as t
                 from pg_tables where schemaname = 'public' loop
          execute 'truncate table ' || r.t || ' restart identity cascade';
        end loop;
        truncate table auth.users restart identity cascade;
        for r in select quote_ident(schemaname) || '.' || quote_ident(sequencename) as s
                 from pg_sequences where schemaname = 'public' loop
          execute 'alter sequence ' || r.s || ' restart';
        end loop;
      end $$;
    `)
    await aplicarSeed(client)
  } finally {
    await client.end()
  }
}
