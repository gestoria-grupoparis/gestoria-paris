import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

test('v_movimientos_extracto expone created_at para ordenar igual que el saldo acumulado', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const empresa = (await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`))[0].id as string
  const carga = async (importe: bigint) =>
    (await rpc(contable, 'registrar_carga', { p_idem: randomUUID(), p_empresa: empresa, p_importe: importe, p_fecha: '2026-10-20' }))
      .rows[0].registrar_carga as string
  const a = await carga(100_00n)
  const b = await carga(200_00n)
  const c = await carga(300_00n)

  const filas = await comoUsuario(contable, async (cl) =>
    (await cl.query(
      `select movimiento_id, saldo_resultante_cents from public.v_movimientos_extracto
        order by fecha_operacion desc, created_at desc, movimiento_id desc`,
    )).rows)
  expect(filas.map((f) => [f.movimiento_id, f.saldo_resultante_cents])).toEqual([
    [c, 600_00n], [b, 300_00n], [a, 100_00n],
  ])
})
