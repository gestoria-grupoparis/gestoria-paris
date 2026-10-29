import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, sqlAdmin } from './helpers'

describe('realtime', () => {
  beforeEach(resetDb)

  it('tramites, presupuestos, movimientos y notificaciones se publican en supabase_realtime con RLS activo', async () => {
    const r: any = await sqlAdmin(
      `select c.relname, c.relrowsecurity
         from pg_publication_tables p
         join pg_class c on c.relname = p.tablename and c.relnamespace = 'public'::regnamespace
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
        order by 1`,
    )
    const rows = r.rows ?? r
    expect(rows.map((x: any) => x.relname)).toEqual(['movimientos', 'notificaciones', 'presupuestos', 'tramites'])
    expect(rows.every((x: any) => x.relrowsecurity === true)).toBe(true)
  })
})
