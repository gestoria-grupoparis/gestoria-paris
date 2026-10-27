import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const crearTramite = async (userId: string, oferta = 'OF-700') => {
  const r = await rpc(userId, 'crear_tramite', {
    p_idem: randomUUID(),
    p_empresa: await idPorNombre('empresas', 'Paris Autos'),
    p_sucursal: await idPorNombre('sucursales', 'San Luis'),
    p_tipo: 'patentamiento_0km',
    p_cliente: 'Juan Pérez',
    p_cuenta_personal: 'CP-1001',
    p_oferta: oferta,
    p_vehiculo: 'Fiat Cronos 1.3',
    p_dominio: 'AB123CD',
  })
  return r.rows[0].crear_tramite as string
}

const tramite = async (id: string) =>
  (await sqlAdmin(`select * from public.tramites where id = $1`, [id]))[0]

const presupuestos = (id: string) =>
  sqlAdmin(
    `select version, arancel_cents, prenda_cents, sellado_cents, otros_cents, total_cents, motivo, creado_por
       from public.presupuestos where tramite_id = $1 order by version`,
    [id],
  )

type Conceptos = { arancel: bigint; prenda: bigint; sellado: bigint; otros: bigint }

const registrar = async (userId: string, id: string, c: Conceptos, motivo: string | null = null) =>
  (
    await rpc(userId, 'registrar_presupuesto', {
      p_tramite: id,
      p_arancel: c.arancel,
      p_prenda: c.prenda,
      p_sellado: c.sellado,
      p_otros: c.otros,
      p_motivo: motivo,
    })
  ).rows[0].registrar_presupuesto as number

const BASE: Conceptos = { arancel: 12_000_000n, prenda: 3_500_000n, sellado: 2_450_075n, otros: 99n }

// Trámite de Paris Autos / San Luis autorizado con la gestora dada.
const tramiteAutorizado = async (gestora: string, oferta = 'OF-700') => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable, oferta)
  await rpc(contable, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
  return { id, contable }
}

test('cada razón social tiene su cuenta Habitualista con saldo inicial 0', async () => {
  const cuentas = await sqlAdmin(
    `select e.nombre as empresa, c.nombre, c.saldo_inicial_cents, c.saldo_inicial_fecha::text as fecha
       from public.cuentas c join public.empresas e on e.id = c.empresa_id
      order by e.nombre`,
  )
  expect(cuentas).toEqual(
    ['Paris Autos', 'Paris Cars', 'Paris Motor'].map((empresa) => ({
      empresa,
      nombre: `Habitualista ${empresa}`,
      saldo_inicial_cents: 0n,
      fecha: '2026-01-01',
    })),
  )
  // Una sola cuenta por razón social.
  await expect(
    sqlAdmin(
      `insert into public.cuentas (empresa_id, nombre, saldo_inicial_fecha)
       select id, 'Otra', '2026-01-01' from public.empresas where nombre = 'Paris Autos'`,
    ),
  ).rejects.toThrow(/duplicate key/)
})

test('gestora asignada carga presupuesto; total = suma de conceptos', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id } = await tramiteAutorizado(gestora)
  expect((await tramite(id)).orden_compromiso).toBeNull()

  // Otra gestora (no asignada), comercial, admin y gerencia sin alcance no cargan presupuestos.
  for (const rol of ['gestora', 'comercial', 'admin'] as const) {
    const u = await crearUsuario(rol, [{ empresa: 'Paris Autos' }])
    await expect(registrar(u, id, BASE)).rejects.toThrow(/^SIN_PERMISO:/)
  }
  const gerenteCars = await crearUsuario('gerencia', [{ empresa: 'Paris Cars' }])
  await expect(registrar(gerenteCars, id, BASE)).rejects.toThrow(/^SIN_PERMISO:/)
  expect(await presupuestos(id)).toEqual([])

  expect(await registrar(gestora, id, BASE)).toBe(1)

  expect(await presupuestos(id)).toEqual([
    {
      version: 1,
      arancel_cents: 12_000_000n,
      prenda_cents: 3_500_000n,
      sellado_cents: 2_450_075n,
      otros_cents: 99n,
      total_cents: 17_950_174n,
      motivo: null,
      creado_por: gestora,
    },
  ])

  // La versión 1 fija la prioridad de fondos del trámite (primer valor de seq_compromiso).
  const t = await tramite(id)
  expect(t.orden_compromiso).toBe(1n)
  expect(t.version).toBe(2) // cargar presupuesto no es una edición del trámite: no cambia su versión

  const ev = await sqlAdmin(
    `select actor_id, accion from public.eventos where entidad = 'presupuestos'`,
  )
  expect(ev).toEqual([{ actor_id: gestora, accion: 'insert' }])

  // Gerencia y contable con alcance también cargan; el siguiente trámite toma el orden siguiente.
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos', sucursal: 'San Luis' }])
  const otro = (await tramiteAutorizado(gestora, 'OF-701')).id
  expect(await registrar(gerente, otro, { arancel: 100n, prenda: 0n, sellado: 0n, otros: 0n })).toBe(1)
  expect((await tramite(otro)).orden_compromiso).toBe(2n)
})

test('segunda versión sin motivo falla; con motivo crea version 2 y la 1 queda intacta', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  await registrar(gestora, id, BASE)
  const v1 = (await presupuestos(id))[0]

  await expect(registrar(gestora, id, BASE)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(registrar(gestora, id, BASE, '   ')).rejects.toThrow(/^DATO_INVALIDO:/)
  expect(await presupuestos(id)).toHaveLength(1)

  const nuevo = { arancel: 12_500_000n, prenda: 0n, sellado: 2_450_075n, otros: 0n }
  expect(await registrar(contable, id, nuevo, 'aumento de arancel DNRPA')).toBe(2)

  const filas = await presupuestos(id)
  expect(filas).toHaveLength(2)
  expect(filas[0]).toEqual(v1)
  expect(filas[1]).toEqual({
    version: 2,
    arancel_cents: 12_500_000n,
    prenda_cents: 0n,
    sellado_cents: 2_450_075n,
    otros_cents: 0n,
    total_cents: 14_950_075n,
    motivo: 'aumento de arancel DNRPA',
    creado_por: contable,
  })

  // La prioridad de fondos sigue siendo la de la versión 1.
  expect((await tramite(id)).orden_compromiso).toBe(1n)

  const ev = await sqlAdmin(
    `select motivo from public.eventos
      where entidad = 'presupuestos' and accion = 'insert' and despues ->> 'version' = '2'`,
  )
  expect(ev).toEqual([{ motivo: 'aumento de arancel DNRPA' }])
})

test('presupuesto en borrador da NO_AUTORIZADO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  await expect(registrar(contable, id, BASE)).rejects.toThrow(/^NO_AUTORIZADO:/)
  expect(await presupuestos(id)).toEqual([])
  expect((await tramite(id)).orden_compromiso).toBeNull()

  // Se habilita en autorizado, en_gestoria y presentado; no después.
  await rpc(contable, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
  await rpc(contable, 'cambiar_estado', { p_tramite: id, p_estado: 'en_gestoria', p_motivo: null, p_version: 2 })
  expect(await registrar(gestora, id, BASE)).toBe(1)
  await rpc(gestora, 'cambiar_estado', { p_tramite: id, p_estado: 'presentado', p_motivo: null, p_version: 3 })
  expect(await registrar(gestora, id, BASE, 'reajuste')).toBe(2)
  await rpc(gestora, 'cambiar_estado', {
    p_tramite: id,
    p_estado: 'finalizado_registro',
    p_motivo: null,
    p_version: 4,
  })
  await expect(registrar(contable, id, BASE, 'tarde')).rejects.toThrow(/^NO_AUTORIZADO:/)
  expect(await presupuestos(id)).toHaveLength(2)

  await expect(registrar(contable, randomUUID(), BASE)).rejects.toThrow(/^NO_ENCONTRADO:/)
})

test('total 0 o concepto negativo da DATO_INVALIDO', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id } = await tramiteAutorizado(gestora)

  const casos: Conceptos[] = [
    { arancel: 0n, prenda: 0n, sellado: 0n, otros: 0n },
    // Total positivo pero con un concepto negativo.
    { arancel: 1_000_000n, prenda: -1n, sellado: 0n, otros: 0n },
    { arancel: 1_000_000n, prenda: 0n, sellado: 0n, otros: -500n },
    { arancel: -100n, prenda: 0n, sellado: 0n, otros: 0n },
  ]
  for (const c of casos) {
    await expect(registrar(gestora, id, c)).rejects.toThrow(/^DATO_INVALIDO:/)
  }
  // Conceptos nulos tampoco valen.
  await expect(
    rpc(gestora, 'registrar_presupuesto', {
      p_tramite: id,
      p_arancel: 100n,
      p_prenda: null,
      p_sellado: 0n,
      p_otros: 0n,
    }),
  ).rejects.toThrow(/^DATO_INVALIDO:/)

  expect(await presupuestos(id)).toEqual([])
  expect((await tramite(id)).orden_compromiso).toBeNull()

  // La tabla también lo impide aunque se inserte directo como dueño.
  await expect(
    sqlAdmin(
      `insert into public.presupuestos (tramite_id, version, arancel_cents, prenda_cents, creado_por)
       values ($1, 1, 1000, -1, $2)`,
      [id, gestora],
    ),
  ).rejects.toThrow(/check constraint/)
  await expect(
    sqlAdmin(`insert into public.presupuestos (tramite_id, version, creado_por) values ($1, 1, $2)`, [id, gestora]),
  ).rejects.toThrow(/check constraint/)
})

test('update sobre presupuestos falla (inmutable)', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id } = await tramiteAutorizado(gestora)
  await registrar(gestora, id, BASE)
  const antes = await presupuestos(id)

  // Ni siquiera el dueño de la tabla puede modificar, borrar o vaciar presupuestos.
  await expect(
    sqlAdmin(`update public.presupuestos set arancel_cents = 1 where tramite_id = $1`, [id]),
  ).rejects.toThrow(/registro inmutable/)
  await expect(sqlAdmin(`delete from public.presupuestos where tramite_id = $1`, [id])).rejects.toThrow(
    /registro inmutable/,
  )
  await expect(sqlAdmin(`truncate public.presupuestos cascade`)).rejects.toThrow(/registro inmutable/)

  expect(await presupuestos(id)).toEqual(antes)
})
