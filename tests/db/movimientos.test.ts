import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

type Empresa = 'Paris Autos' | 'Paris Cars' | 'Paris Motor'

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const cuentaDe = async (empresa: Empresa) =>
  (
    await sqlAdmin(
      `select c.id from public.cuentas c join public.empresas e on e.id = c.empresa_id where e.nombre = $1`,
      [empresa],
    )
  )[0].id as string

// Saldo registrado = saldo inicial + Σ movimientos (la vista llega en la Tarea 8).
const saldo = async (empresa: Empresa) =>
  (
    await sqlAdmin(
      `select c.saldo_inicial_cents + coalesce(sum(m.importe_cents), 0)::bigint as saldo
         from public.cuentas c
         join public.empresas e on e.id = c.empresa_id
         left join public.movimientos m on m.cuenta_id = c.id
        where e.nombre = $1
        group by c.id`,
      [empresa],
    )
  )[0].saldo as bigint

const movimiento = async (id: string) =>
  (
    await sqlAdmin(
      `select cuenta_id, tipo, importe_cents, fecha_operacion::text as fecha, tramite_id, revierte_id,
              arancel_cents, prenda_cents, sellado_cents, otros_cents, es_pago_final, motivo, creado_por
         from public.movimientos where id = $1`,
      [id],
    )
  )[0]

const cantidadMovimientos = async () =>
  Number((await sqlAdmin(`select count(*)::int as n from public.movimientos`))[0].n)

const tramite = async (id: string) =>
  (await sqlAdmin(`select * from public.tramites where id = $1`, [id]))[0]

const crearTramite = async (userId: string, empresa: Empresa = 'Paris Autos', oferta = 'OF-800') => {
  const r = await rpc(userId, 'crear_tramite', {
    p_idem: randomUUID(),
    p_empresa: await idPorNombre('empresas', empresa),
    p_sucursal: await idPorNombre('sucursales', 'San Luis Capital'),
    p_tipo: 'patentamiento_0km',
    p_cliente: 'Juan Pérez',
    p_cuenta_personal: 'CP-1001',
    p_oferta: oferta,
    p_vehiculo: 'Fiat Cronos 1.3',
    p_dominio: 'AB123CD',
  })
  return r.rows[0].crear_tramite as string
}

// Trámite de la empresa dada (San Luis) autorizado con la gestora dada.
const tramiteAutorizado = async (gestora: string, empresa: Empresa = 'Paris Autos', oferta = 'OF-800') => {
  const contable = await crearUsuario('contable', [{ empresa }])
  const id = await crearTramite(contable, empresa, oferta)
  await rpc(contable, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
  return { id, contable }
}

const FECHA = '2026-10-27'

const carga = async (userId: string, empresa: Empresa, importe: bigint, idem = randomUUID()) =>
  (
    await rpc(userId, 'registrar_carga', {
      p_idem: idem,
      p_empresa: await idPorNombre('empresas', empresa),
      p_importe: importe,
      p_fecha: FECHA,
    })
  ).rows[0].registrar_carga as string

const ajuste = async (userId: string, empresa: Empresa, importe: bigint, motivo: string | null) =>
  (
    await rpc(userId, 'registrar_ajuste', {
      p_idem: randomUUID(),
      p_empresa: await idPorNombre('empresas', empresa),
      p_importe: importe,
      p_fecha: FECHA,
      p_motivo: motivo,
    })
  ).rows[0].registrar_ajuste as string

type Desglose = { arancel: bigint | null; prenda: bigint | null; sellado: bigint | null; otros: bigint | null }

const pago = async (
  userId: string,
  tramiteId: string,
  d: Desglose,
  opts: { final?: boolean; motivo?: string | null; idem?: string } = {},
) =>
  (
    await rpc(userId, 'registrar_pago', {
      p_idem: opts.idem ?? randomUUID(),
      p_tramite: tramiteId,
      p_fecha: FECHA,
      p_arancel: d.arancel,
      p_prenda: d.prenda,
      p_sellado: d.sellado,
      p_otros: d.otros,
      p_es_final: opts.final ?? false,
      p_motivo: opts.motivo ?? null,
    })
  ).rows[0].registrar_pago as string

const revertir = async (userId: string, movimientoId: string, motivo: string | null) =>
  (
    await rpc(userId, 'revertir_movimiento', {
      p_idem: randomUUID(),
      p_movimiento: movimientoId,
      p_motivo: motivo,
    })
  ).rows[0].revertir_movimiento as string

const PAGO: Desglose = { arancel: 12_000_000n, prenda: 0n, sellado: 2_450_075n, otros: 99n } // 14.450.174 cents

test('carga suma, pago resta, ajuste de gerencia con signo', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const cuentaAutos = await cuentaDe('Paris Autos')
  expect(await saldo('Paris Autos')).toBe(0n)

  const idCarga = await carga(contable, 'Paris Autos', 300_000_000n)
  expect(await saldo('Paris Autos')).toBe(300_000_000n)
  expect(await movimiento(idCarga)).toMatchObject({
    cuenta_id: cuentaAutos,
    tipo: 'carga',
    importe_cents: 300_000_000n,
    fecha: FECHA,
    tramite_id: null,
    arancel_cents: null,
    es_pago_final: false,
    creado_por: contable,
  })

  const idPago = await pago(gestora, id, PAGO)
  expect(await saldo('Paris Autos')).toBe(285_549_826n)
  expect(await movimiento(idPago)).toEqual({
    cuenta_id: cuentaAutos,
    tipo: 'pago_tramite',
    importe_cents: -14_450_174n,
    fecha: FECHA,
    tramite_id: id,
    revierte_id: null,
    arancel_cents: 12_000_000n,
    prenda_cents: 0n,
    sellado_cents: 2_450_075n,
    otros_cents: 99n,
    es_pago_final: false,
    motivo: null,
    creado_por: gestora,
  })
  expect((await tramite(id)).pago_final_at).toBeNull()

  // Ajuste de gerencia: con signo y motivo obligatorio.
  const idAjuste = await ajuste(gerente, 'Paris Autos', -50_000n, 'diferencia con extracto')
  expect(await saldo('Paris Autos')).toBe(285_499_826n)
  await ajuste(gerente, 'Paris Autos', 100n, 'redondeo')
  expect(await saldo('Paris Autos')).toBe(285_499_926n)
  expect(await movimiento(idAjuste)).toMatchObject({
    tipo: 'ajuste',
    importe_cents: -50_000n,
    motivo: 'diferencia con extracto',
    creado_por: gerente,
  })
  const ev = await sqlAdmin(
    `select actor_id, accion, motivo from public.eventos where entidad = 'movimientos' and entidad_id = $1`,
    [idAjuste],
  )
  expect(ev).toEqual([{ actor_id: gerente, accion: 'insert', motivo: 'diferencia con extracto' }])

  // Validaciones: ajuste sin motivo o en 0, carga no positiva.
  await expect(ajuste(gerente, 'Paris Autos', -1n, null)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(ajuste(gerente, 'Paris Autos', -1n, '  ')).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(ajuste(gerente, 'Paris Autos', 0n, 'nada')).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(carga(contable, 'Paris Autos', 0n)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(carga(contable, 'Paris Autos', -100n)).rejects.toThrow(/^DATO_INVALIDO:/)

  // El ajuste es solo de gerencia; carga y ajuste exigen alcance sobre la razón social.
  await expect(ajuste(contable, 'Paris Autos', 100n, 'intento')).rejects.toThrow(/^SIN_PERMISO:/)
  const gerenteCars = await crearUsuario('gerencia', [{ empresa: 'Paris Cars' }])
  await expect(ajuste(gerenteCars, 'Paris Autos', 100n, 'intento')).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(carga(gerenteCars, 'Paris Autos', 100n)).rejects.toThrow(/^SIN_PERMISO:/)
  expect(await saldo('Paris Autos')).toBe(285_499_926n)
  expect(await cantidadMovimientos()).toBe(4)
})

test('pago con desglose que no suma el importe da DATO_INVALIDO', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id } = await tramiteAutorizado(gestora)

  // El importe del pago se deriva del desglose: un desglose sin total positivo, con un
  // concepto negativo o incompleto no puede dar un importe válido.
  const invalidos: Desglose[] = [
    { arancel: 0n, prenda: 0n, sellado: 0n, otros: 0n },
    { arancel: 1_000_000n, prenda: -1n, sellado: 0n, otros: 0n },
    { arancel: -100n, prenda: 0n, sellado: 0n, otros: 0n },
    { arancel: 1_000_000n, prenda: null, sellado: 0n, otros: 0n },
  ]
  for (const d of invalidos) {
    await expect(pago(gestora, id, d)).rejects.toThrow(/^DATO_INVALIDO:/)
  }
  expect(await cantidadMovimientos()).toBe(0)

  // La tabla lo impide aunque se inserte directo como dueño (sin pasar por la RPC).
  const cuentaAutos = await cuentaDe('Paris Autos')
  const insertar = (importe: bigint, arancel: bigint, tramiteId: string | null = id) =>
    sqlAdmin(
      `insert into public.movimientos (cuenta_id, tipo, importe_cents, fecha_operacion, tramite_id,
                                       arancel_cents, prenda_cents, sellado_cents, otros_cents, creado_por, idem_key)
       values ($1, 'pago_tramite', $2, $3, $4, $5, 0, 0, 0, $6, gen_random_uuid())`,
      [cuentaAutos, importe, FECHA, tramiteId, arancel, gestora],
    )
  await expect(insertar(-1_000n, 999n)).rejects.toThrow(/check constraint/) // desglose ≠ −importe
  await expect(insertar(1_000n, -1_000n)).rejects.toThrow(/check constraint/) // pago positivo
  await expect(insertar(-1_000n, 1_000n, null)).rejects.toThrow(/check constraint/) // sin trámite
  expect(await cantidadMovimientos()).toBe(0)
})

test('pago sobre trámite de Paris Cars nunca toca la cuenta de Paris Autos; forzar tramite ajeno da EMPRESA_DISTINTA', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Cars' }])
  const contableAutos = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  await carga(contableAutos, 'Paris Autos', 1_000_000n)
  const { id: tramiteCars } = await tramiteAutorizado(gestora, 'Paris Cars')

  // La cuenta del pago se deriva del trámite: va a la Habitualista de Paris Cars.
  const idPago = await pago(gestora, tramiteCars, PAGO)
  expect((await movimiento(idPago)).cuenta_id).toBe(await cuentaDe('Paris Cars'))
  expect(await saldo('Paris Cars')).toBe(-14_450_174n)
  expect(await saldo('Paris Autos')).toBe(1_000_000n)

  // Un movimiento forzado (superusuario, sin RPC) con cuenta de Autos y trámite de Cars lo
  // rechaza el trigger.
  await expect(
    sqlAdmin(
      `insert into public.movimientos (cuenta_id, tipo, importe_cents, fecha_operacion, tramite_id,
                                       arancel_cents, prenda_cents, sellado_cents, otros_cents, creado_por, idem_key)
       values ($1, 'pago_tramite', -1000, $2, $3, 1000, 0, 0, 0, $4, gen_random_uuid())`,
      [await cuentaDe('Paris Autos'), FECHA, tramiteCars, gestora],
    ),
  ).rejects.toThrow(/^EMPRESA_DISTINTA:/)
  await expect(
    sqlAdmin(
      `insert into public.movimientos (cuenta_id, tipo, importe_cents, fecha_operacion, tramite_id,
                                       motivo, creado_por, idem_key)
       values ($1, 'reintegro', 1000, $2, $3, 'forzado', $4, gen_random_uuid())`,
      [await cuentaDe('Paris Autos'), FECHA, tramiteCars, gestora],
    ),
  ).rejects.toThrow(/^EMPRESA_DISTINTA:/)
  expect(await saldo('Paris Autos')).toBe(1_000_000n)
  expect(await cantidadMovimientos()).toBe(2)
})

test('gestora no puede registrar_ajuste ni registrar_carga (SIN_PERMISO)', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id } = await tramiteAutorizado(gestora)
  const idPago = await pago(gestora, id, PAGO)

  await expect(carga(gestora, 'Paris Autos', 100n)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(ajuste(gestora, 'Paris Autos', 100n, 'intento')).rejects.toThrow(/^SIN_PERMISO:/)
  // Tampoco revierte ni registra reintegros (los pide a contable).
  await expect(revertir(gestora, idPago, 'me equivoqué')).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(
    rpc(gestora, 'registrar_reintegro', {
      p_idem: randomUUID(),
      p_tramite: id,
      p_importe: 100n,
      p_fecha: FECHA,
      p_motivo: 'intento',
    }),
  ).rejects.toThrow(/^SIN_PERMISO:/)
  // Comercial y admin no registran nada.
  for (const rol of ['comercial', 'admin'] as const) {
    const u = await crearUsuario(rol, [{ empresa: 'Paris Autos' }])
    await expect(carga(u, 'Paris Autos', 100n)).rejects.toThrow(/^SIN_PERMISO:/)
    await expect(pago(u, id, PAGO)).rejects.toThrow(/^SIN_PERMISO:/)
  }
  expect(await cantidadMovimientos()).toBe(1)
})

test('pago solo sobre trámites autorizados para la gestora; gerencia y contable con motivo de excepción (R24)', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)

  // Otra gestora (no asignada) no paga trámites ajenos.
  const otraGestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  await expect(pago(otraGestora, id, PAGO)).rejects.toThrow(/^SIN_PERMISO:/)

  // Fuera de autorizado..finalizado_registro la gestora asignada ya no paga.
  await rpc(contable, 'cambiar_estado', { p_tramite: id, p_estado: 'suspendido', p_motivo: 'falta legajo', p_version: 2 })
  await expect(pago(gestora, id, PAGO)).rejects.toThrow(/^NO_AUTORIZADO:/)

  // Gerencia y contable sí, pero solo con motivo.
  await expect(pago(contable, id, PAGO)).rejects.toThrow(/^NO_AUTORIZADO:/)
  await expect(pago(contable, id, PAGO, { motivo: '  ' })).rejects.toThrow(/^NO_AUTORIZADO:/)
  const borrador = await crearTramite(contable, 'Paris Autos', 'OF-801')
  const idPago = await pago(contable, borrador, PAGO, { motivo: 'pagado antes de autorizar' })
  expect(await movimiento(idPago)).toMatchObject({
    tipo: 'pago_tramite',
    importe_cents: -14_450_174n,
    tramite_id: borrador,
    motivo: 'pagado antes de autorizar',
  })
  expect(await cantidadMovimientos()).toBe(1)
})

test('pago que deja saldo negativo se registra igual', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  await carga(contable, 'Paris Autos', 1_000_000n)

  const idPago = await pago(gestora, id, PAGO, { final: true })
  expect(await saldo('Paris Autos')).toBe(-13_450_174n)
  expect(await movimiento(idPago)).toMatchObject({ importe_cents: -14_450_174n, es_pago_final: true })
  // El pago final cierra el compromiso del trámite.
  expect((await tramite(id)).pago_final_at).toBeInstanceOf(Date)
})

test('reintegro devuelve fondos a la cuenta del trámite', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Cars' }])
  const { id, contable } = await tramiteAutorizado(gestora, 'Paris Cars')
  await pago(gestora, id, PAGO)

  const reintegro = (importe: bigint, motivo: string | null) =>
    rpc(contable, 'registrar_reintegro', {
      p_idem: randomUUID(),
      p_tramite: id,
      p_importe: importe,
      p_fecha: FECHA,
      p_motivo: motivo,
    })
  await expect(reintegro(0n, 'nada')).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(reintegro(-5n, 'negativo')).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(reintegro(5n, null)).rejects.toThrow(/^DATO_INVALIDO:/)

  const idReintegro = (await reintegro(2_450_075n, 'devolución de sellado')).rows[0].registrar_reintegro
  expect(await movimiento(idReintegro)).toMatchObject({
    cuenta_id: await cuentaDe('Paris Cars'),
    tipo: 'reintegro',
    importe_cents: 2_450_075n,
    tramite_id: id,
    arancel_cents: null,
    motivo: 'devolución de sellado',
    creado_por: contable,
  })
  expect(await saldo('Paris Cars')).toBe(-12_000_099n)
  expect(await saldo('Paris Autos')).toBe(0n)
})

test('revertir un pago crea movimiento inverso; revertir de nuevo da DUPLICADO; revertir una reversión da DATO_INVALIDO; saldo final intacto', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  const idCarga = await carga(contable, 'Paris Autos', 50_000_000n)
  const idPago = await pago(gestora, id, PAGO, { final: true })
  expect(await saldo('Paris Autos')).toBe(35_549_826n)
  expect((await tramite(id)).pago_final_at).not.toBeNull()

  await expect(revertir(contable, idPago, null)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(revertir(contable, randomUUID(), 'no existe')).rejects.toThrow(/^NO_ENCONTRADO:/)

  const original = await movimiento(idPago)
  const idRev = await revertir(contable, idPago, 'pago cargado dos veces')
  // La reversión lleva la fecha operativa del día (hora de Buenos Aires) en que se registra.
  const hoy = (
    await sqlAdmin(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as hoy`)
  )[0].hoy
  expect(await movimiento(idRev)).toEqual({
    cuenta_id: original.cuenta_id,
    tipo: 'reversion',
    importe_cents: 14_450_174n,
    fecha: hoy,
    tramite_id: id,
    revierte_id: idPago,
    arancel_cents: -12_000_000n,
    prenda_cents: 0n,
    sellado_cents: -2_450_075n,
    otros_cents: -99n,
    es_pago_final: false,
    motivo: 'pago cargado dos veces',
    creado_por: contable,
  })
  // El original no se toca; el trámite vuelve a no tener pago final.
  expect(await movimiento(idPago)).toEqual(original)
  expect((await tramite(id)).pago_final_at).toBeNull()
  expect(await saldo('Paris Autos')).toBe(50_000_000n)

  await expect(revertir(contable, idPago, 'otra vez')).rejects.toThrow(/^DUPLICADO:/)
  await expect(revertir(contable, idRev, 'deshacer la reversión')).rejects.toThrow(/^DATO_INVALIDO:/)
  expect(await saldo('Paris Autos')).toBe(50_000_000n)
  expect(await cantidadMovimientos()).toBe(3)

  // Una carga también se revierte (con signo inverso y sin desglose).
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const idRevCarga = await revertir(gerente, idCarga, 'carga inexistente')
  expect(await movimiento(idRevCarga)).toMatchObject({
    tipo: 'reversion',
    importe_cents: -50_000_000n,
    tramite_id: null,
    revierte_id: idCarga,
    arancel_cents: null,
  })
  expect(await saldo('Paris Autos')).toBe(0n)

  // Gerencia de otra razón social no revierte movimientos de Paris Autos.
  const gerenteCars = await crearUsuario('gerencia', [{ empresa: 'Paris Cars' }])
  const idPago2 = await pago(gestora, id, PAGO)
  await expect(revertir(gerenteCars, idPago2, 'ajeno')).rejects.toThrow(/^SIN_PERMISO:/)
})

test('mismo idem_key en registrar_pago devuelve el mismo id', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  const idem = randomUUID()

  const primero = await pago(gestora, id, PAGO, { idem })
  const segundo = await pago(gestora, id, PAGO, { idem })
  expect(segundo).toBe(primero)
  // Un reintento devuelve el original sin volver a validar ni escribir.
  const tercero = await pago(gestora, id, { arancel: 1n, prenda: 0n, sellado: 0n, otros: 0n }, { idem })
  expect(tercero).toBe(primero)
  expect(await cantidadMovimientos()).toBe(1)
  expect(await saldo('Paris Autos')).toBe(-14_450_174n)

  // También en las cargas.
  const idemCarga = randomUUID()
  const c1 = await carga(contable, 'Paris Autos', 1_000n, idemCarga)
  expect(await carga(contable, 'Paris Autos', 1_000n, idemCarga)).toBe(c1)
  expect(await cantidadMovimientos()).toBe(2)
})

test('otro usuario que reusa el idem ajeno recibe DUPLICADO, no el id', async () => {
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const { id, contable } = await tramiteAutorizado(gestora)
  const idem = randomUUID()
  await pago(gestora, id, PAGO, { idem })
  const otraGestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  await expect(pago(otraGestora, id, PAGO, { idem })).rejects.toThrow(/DUPLICADO/)
  await expect(carga(contable, 'Paris Autos', 1_000n, idem)).rejects.toThrow(/DUPLICADO/)
  expect(await cantidadMovimientos()).toBe(1)
})

test('delete sobre movimientos falla', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const idCarga = await carga(contable, 'Paris Autos', 1_000_000n)
  const antes = await movimiento(idCarga)

  // Ni siquiera el dueño de la tabla puede borrar, modificar o vaciar movimientos.
  await expect(sqlAdmin(`delete from public.movimientos where id = $1`, [idCarga])).rejects.toThrow(
    /registro inmutable/,
  )
  await expect(
    sqlAdmin(`update public.movimientos set importe_cents = 1 where id = $1`, [idCarga]),
  ).rejects.toThrow(/registro inmutable/)
  await expect(sqlAdmin(`truncate public.movimientos cascade`)).rejects.toThrow(/registro inmutable/)

  expect(await movimiento(idCarga)).toEqual(antes)
  expect(await saldo('Paris Autos')).toBe(1_000_000n)
})
