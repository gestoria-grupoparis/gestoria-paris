import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, sqlAdmin } from './helpers'

beforeEach(resetDb)

test('cambiar el rol de un perfil genera un evento con antes/después y actor', async () => {
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos', sucursal: 'San Luis Capital' }])

  // Simula una RPC SECURITY DEFINER: escribe como dueño de la tabla con las claims del gerente
  // y el motivo guardado con set_config('app.motivo', ..., true).
  await comoUsuario(gerente, async (c) => {
    await c.query('reset role')
    await c.query(`select set_config('app.motivo', $1, true)`, ['pasa a contable'])
    await c.query(`update public.perfiles set rol = 'contable' where id = $1`, [gestora])
  })

  const eventos = await sqlAdmin(
    `select actor_id, entidad, entidad_id, accion, antes, despues, motivo, at
       from public.eventos where entidad = 'perfiles' and accion = 'update'`,
  )
  expect(eventos).toHaveLength(1)
  const [e] = eventos
  expect(e.actor_id).toBe(gerente)
  expect(e.entidad).toBe('perfiles')
  expect(e.entidad_id).toBe(gestora)
  expect(e.antes.rol).toBe('gestora')
  expect(e.despues.rol).toBe('contable')
  expect(e.antes.id).toBe(gestora)
  expect(e.motivo).toBe('pasa a contable')
  expect(e.at).toBeInstanceOf(Date)

  // El alta del perfil y de su alcance también quedaron auditadas (sin actor ni motivo: no hubo sesión).
  const altas = await sqlAdmin(
    `select entidad, entidad_id, actor_id, motivo, antes, despues
       from public.eventos where accion = 'insert' and entidad_id = $1 order by id`,
    [gestora],
  )
  expect(altas.map((a) => a.entidad)).toEqual(['perfiles', 'alcances'])
  expect(altas.every((a) => a.actor_id === null && a.motivo === null && a.antes === null)).toBe(true)
  expect(altas[1].despues.perfil_id).toBe(gestora)
})

test('update, delete y truncate sobre eventos fallan incluso como superusuario', async () => {
  await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const [{ n }] = await sqlAdmin('select count(*)::int as n from public.eventos')
  expect(n).toBeGreaterThan(0)

  await expect(sqlAdmin(`update public.eventos set motivo = 'alterado'`)).rejects.toThrow(/registro inmutable/)
  await expect(sqlAdmin('delete from public.eventos')).rejects.toThrow(/registro inmutable/)
  await expect(sqlAdmin('truncate public.eventos')).rejects.toThrow(/registro inmutable/)

  const [{ n: despues }] = await sqlAdmin('select count(*)::int as n from public.eventos')
  expect(despues).toBe(n)
  const [{ alterados }] = await sqlAdmin(`select count(*)::int as alterados from public.eventos where motivo = 'alterado'`)
  expect(alterados).toBe(0)
})
