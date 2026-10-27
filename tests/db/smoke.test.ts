import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb } from './helpers'

beforeEach(resetDb)

test('la base arranca y auth.uid() devuelve el usuario simulado', async () => {
  const id = await crearUsuario('contable', [])
  const uid = await comoUsuario(id, c => c.query('select auth.uid() as u').then(r => r.rows[0].u))
  expect(uid).toBe(id)
})
