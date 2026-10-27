import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idEmpresa = async (nombre: string) =>
  (await sqlAdmin(`select id from public.empresas where nombre = $1`, [nombre]))[0].id as string

async function preparar() {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }, { empresa: 'Paris Cars' }])
  const empresa = await idEmpresa('Paris Autos')

  const carga = async (importe: bigint, fecha: string, quien = contable, emp = empresa) =>
    (await rpc(quien, 'registrar_carga', { p_idem: randomUUID(), p_empresa: emp, p_importe: importe, p_fecha: fecha }))
      .rows[0].registrar_carga as string

  const conciliar = async (fechaCorte: string, externo: bigint, movimientos: string[], emp = empresa) =>
    (await rpc(contable, 'registrar_conciliacion', {
      p_empresa: emp, p_fecha_corte: fechaCorte, p_saldo_externo: externo, p_nota: 'control semanal',
      p_movimientos: movimientos,
    })).rows[0].registrar_conciliacion as string

  const conciliacion = async (id: string) =>
    (await sqlAdmin(`select * from public.conciliaciones where id = $1`, [id]))[0]

  const saldos = () =>
    comoUsuario(contable, async (c) =>
      (await c.query(`select *, ultima_conciliacion_fecha::text as fecha_corte from public.v_saldos where empresa_id = $1`, [empresa])).rows[0])

  return { contable, empresa, carga, conciliar, conciliacion, saldos }
}

test('carga no registrada en el sistema aparece como diferencia positiva', async () => {
  const { carga, conciliar, conciliacion, saldos } = await preparar()
  await carga(100_000_00n, '2026-10-20')
  // Posterior al corte: no entra en el saldo interno.
  await carga(30_000_00n, '2026-10-26')

  // La Habitualista muestra 150.000 al 25/10: hay una carga de 50.000 que nadie registró (caso H).
  const id = await conciliar('2026-10-25', 150_000_00n, [])
  const c = await conciliacion(id)
  expect(c.saldo_externo_cents).toBe(150_000_00n)
  expect(c.saldo_interno_cents).toBe(100_000_00n)
  expect(c.diferencia_cents).toBe(50_000_00n)
  expect(c.nota).toBe('control semanal')

  const s = await saldos()
  expect(s.fecha_corte).toBe('2026-10-25')
  expect(s.ultima_diferencia_cents).toBe(50_000_00n)

  // Inmutable, incluso para el dueño.
  await expect(sqlAdmin(`update public.conciliaciones set nota = 'x' where id = $1`, [id])).rejects.toThrow(
    /DATO_INVALIDO/,
  )
})

test('registrar la carga faltante y reconciliar da diferencia 0', async () => {
  const { contable, carga, conciliar, conciliacion, saldos } = await preparar()
  const m1 = await carga(100_000_00n, '2026-10-20')
  await conciliar('2026-10-25', 150_000_00n, [])

  // Caso I: se registra la carga faltante con su fecha real y se vuelve a conciliar.
  const m2 = await carga(50_000_00n, '2026-10-22')
  const id = await conciliar('2026-10-25', 150_000_00n, [m1, m2])
  const c = await conciliacion(id)
  expect(c.saldo_interno_cents).toBe(150_000_00n)
  expect(c.diferencia_cents).toBe(0n)

  const marcados = await sqlAdmin(
    `select movimiento_id from public.movimientos_conciliados where conciliacion_id = $1 order by movimiento_id`,
    [id],
  )
  expect(marcados.map((r) => r.movimiento_id).sort()).toEqual([m1, m2].sort())
  expect((await saldos()).ultima_diferencia_cents).toBe(0n)

  // Un movimiento de otra razón social no se puede marcar.
  const otra = await carga(1_000_00n, '2026-10-20', contable, await idEmpresa('Paris Cars'))
  await expect(conciliar('2026-10-25', 150_000_00n, [otra])).rejects.toThrow(/EMPRESA_DISTINTA/)

  // Solo gerencia y contable concilian.
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  await expect(
    rpc(gestora, 'registrar_conciliacion', {
      p_empresa: await idEmpresa('Paris Autos'), p_fecha_corte: '2026-10-25', p_saldo_externo: 0n,
      p_nota: null, p_movimientos: [],
    }),
  ).rejects.toThrow(/SIN_PERMISO/)
})

test('extracto con saldo resultante correcto fila por fila', async () => {
  const { contable, empresa, carga, conciliar } = await preparar()
  const a = await carga(100_000_00n, '2026-10-20')
  const b = await carga(20_000_00n, '2026-10-22')
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const ajuste = (
    await rpc(gerencia, 'registrar_ajuste', {
      p_idem: randomUUID(), p_empresa: empresa, p_importe: -5_000_00n, p_fecha: '2026-10-21', p_motivo: 'comisión',
    })
  ).rows[0].registrar_ajuste as string
  await conciliar('2026-10-21', 95_000_00n, [a])

  const filas = await comoUsuario(contable, async (c) =>
    (await c.query(
      `select e.*, e.fecha_operacion::text as fecha from public.v_movimientos_extracto e
        join public.cuentas cu on cu.id = e.cuenta_id
       where cu.empresa_id = $1 order by e.fecha_operacion, e.saldo_resultante_cents`,
      [empresa],
    )).rows)
  expect(filas.map((f) => [f.movimiento_id, f.fecha, f.tipo, f.ingreso_cents, f.egreso_cents,
    f.saldo_resultante_cents, f.conciliado])).toEqual([
    [a, '2026-10-20', 'carga', 100_000_00n, 0n, 100_000_00n, true],
    [ajuste, '2026-10-21', 'ajuste', 0n, 5_000_00n, 95_000_00n, false],
    [b, '2026-10-22', 'carga', 20_000_00n, 0n, 115_000_00n, false],
  ])
  expect(filas[0].responsable).toMatch(/^contable /)

  // La gestora no ve el extracto.
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const vistas = await comoUsuario(gestora, async (c) =>
    (await c.query(`select * from public.v_movimientos_extracto`)).rows)
  expect(vistas).toEqual([])
})
