import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const PERIODO = '2026-07-01'
const FECHA = '2026-07-15'

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const ajena = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const otraGestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'Villa Mercedes')

  const crear = async (por: string, periodo = PERIODO, gestoraDe = gestora) =>
    (await rpc(por, 'crear_rendicion', { p_empresa: empresa, p_periodo: periodo, p_honorario: 3250000n, p_gestora: gestoraDe }))
      .rows[0].crear_rendicion as string
  const estado = (por: string, id: string, hacia: string, version: number, motivo: string | null = null) =>
    rpc(por, 'cambiar_estado_rendicion', { p_rendicion: id, p_estado: hacia, p_motivo: motivo, p_version: version })
  const ver = (por: string) =>
    comoUsuario(por, async (c) => (await c.query('select id, estado, version from public.rendiciones')).rows)
  const ruta = (por: string, id: string) =>
    comoUsuario(por, async (c) => (await c.query('select public.puede_ver_rendicion_ruta($1) as ok', [id + '/x.pdf'])).rows[0].ok)

  return { gerencia, contable, ajena, gestora, otraGestora, empresa, sucursal, crear, estado, ver, ruta }
}

test('contable crea la rendición de una gestora y gerencia la ve; sin gestora es dato inválido', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  expect(await f.ver(f.contable)).toEqual([{ id, estado: 'borrador', version: 1 }])
  expect(await f.ver(f.gerencia)).toHaveLength(1)
  await expect(
    rpc(f.gerencia, 'crear_rendicion', { p_empresa: f.empresa, p_periodo: '2026-08-01', p_honorario: 3250000n }),
  ).rejects.toThrow(/^DATO_INVALIDO:/)
  const [r] = await sqlAdmin('select gestora_id from public.rendiciones where id = $1', [id])
  expect(r.gestora_id).toBe(f.gestora)
})

test('gestora no ve ni crea rendiciones (SIN_PERMISO / sin filas)', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  await rpc(f.contable, 'guardar_filas', { p_rendicion: id, p_filas: JSON.stringify([{ nombre: 'GODOY', pago_cents: '1', honorarios_cents: '1' }]) })
  expect(await f.ver(f.gestora)).toEqual([])
  expect(await comoUsuario(f.gestora, async (c) => (await c.query('select id from public.rendicion_filas')).rows)).toEqual([])
  await expect(f.crear(f.gestora)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(f.gestora, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })).rejects.toThrow(/^NO_ENCONTRADO:/)
  await expect(rpc(f.gestora, 'guardar_comprobante', { p_rendicion: id, p_datos: '{}' })).rejects.toThrow(/^NO_ENCONTRADO:/)
  await expect(f.estado(f.gestora, id, 'enviada', 1)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(f.gestora, 'controles_rendicion', { p_rendicion: id })).rejects.toThrow(/^NO_ENCONTRADO:/)
  // Storage: la política del bucket usa puede_ver_rendicion_ruta.
  expect(await f.ruta(f.gestora, id)).toBe(false)
  expect(await f.ruta(f.contable, id)).toBe(true)
})

test('contable sin alcance no ve la rendición de Paris Autos', async () => {
  const f = await preparar()
  await f.crear(f.contable)
  expect(await f.ver(f.ajena)).toEqual([])
  const comercial = await crearUsuario('comercial', [{ empresa: 'Paris Autos' }])
  expect(await f.ver(comercial)).toEqual([])
  await expect(f.crear(comercial)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(f.crear(f.ajena)).rejects.toThrow(/^SIN_PERMISO:/)
})

test('una rendición aprobada no se edita (TRANSICION_INVALIDA) y reabrir exige motivo', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  await rpc(f.contable, 'guardar_filas', {
    p_rendicion: id,
    p_filas: JSON.stringify([{ nombre: 'GODOY MARIO', pago_cents: '116385524', honorarios_cents: '3250000' }]),
  })
  await f.estado(f.contable, id, 'enviada', 1)
  await expect(rpc(f.contable, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await f.estado(f.gerencia, id, 'aprobada', 2)
  await expect(rpc(f.contable, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(
    rpc(f.contable, 'guardar_comprobante', { p_rendicion: id, p_datos: JSON.stringify({ tipo: 'otro' }) }),
  ).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(f.estado(f.contable, id, 'observada', 3, 'x')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  // Ni siquiera aprobar una rendición crea movimientos.
  expect(await sqlAdmin('select count(*)::int as n from public.movimientos')).toEqual([{ n: 0 }])
  await expect(f.estado(f.gerencia, id, 'borrador', 3)).rejects.toThrow(/^DATO_INVALIDO:/)
  await f.estado(f.gerencia, id, 'borrador', 3, 'faltaba una factura')
  await rpc(f.contable, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })
})

test('observar exige motivo y vuelve a edición', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  await f.estado(f.contable, id, 'enviada', 1)
  await expect(f.estado(f.gerencia, id, 'observada', 2)).rejects.toThrow(/^DATO_INVALIDO:/)
  await f.estado(f.gerencia, id, 'observada', 2, 'falta la factura de GODOY')
  const [r] = await sqlAdmin('select estado, motivo_observacion from public.rendiciones where id = $1', [id])
  expect(r).toEqual({ estado: 'observada', motivo_observacion: 'falta la factura de GODOY' })
  await rpc(f.contable, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })
  await f.estado(f.contable, id, 'enviada', 3)
})

test('versión vieja da VERSION_CONFLICTO', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  await f.estado(f.contable, id, 'enviada', 1)
  await expect(f.estado(f.gerencia, id, 'aprobada', 1)).rejects.toThrow(/^VERSION_CONFLICTO:/)
})

test('no se puede crear dos rendiciones del mismo mes para la misma gestora y empresa (DUPLICADO)', async () => {
  const f = await preparar()
  await f.crear(f.contable)
  await expect(f.crear(f.gerencia, '2026-07-20')).rejects.toThrow(/^DUPLICADO:/)
  await f.crear(f.gerencia, '2026-07-20', f.otraGestora)
})

test('guardar_comprobante guarda las líneas y lo audita', async () => {
  const f = await preparar()
  const id = await f.crear(f.contable)
  const c = (
    await rpc(f.contable, 'guardar_comprobante', {
      p_rendicion: id,
      p_datos: JSON.stringify({
        tipo: 'recibo_dnrpa', archivo_path: id + '/abc.pdf', archivo_sha256: 'abc', numero: '171648',
        total_cents: '43153969', revision: 'pendiente',
        lineas: [{ concepto: 'Arancel', importe_cents: '43683969' }, { concepto: 'Bonif', importe_cents: '-530000' }],
      }),
    })
  ).rows[0].guardar_comprobante as string
  const lineas = await sqlAdmin('select importe_cents from public.comprobante_lineas where comprobante_id = $1 order by importe_cents', [c])
  expect(lineas.map((l) => l.importe_cents)).toEqual([-530000n, 43683969n])
  await rpc(f.gerencia, 'guardar_comprobante', {
    p_rendicion: id,
    p_datos: JSON.stringify({ id: c, tipo: 'recibo_dnrpa', revision: 'confirmado', lineas: [] }),
  })
  expect(await sqlAdmin('select count(*)::int as n from public.comprobante_lineas')).toEqual([{ n: 0 }])
  const [cmp] = await sqlAdmin('select revision, revisado_por from public.comprobantes where id = $1', [c])
  expect(cmp).toEqual({ revision: 'confirmado', revisado_por: f.gerencia })
  const ev = await sqlAdmin("select count(*)::int as n from public.eventos where entidad = 'comprobantes'")
  expect(ev[0].n).toBeGreaterThan(0)
  await expect(
    rpc(f.ajena, 'guardar_comprobante', { p_rendicion: id, p_datos: JSON.stringify({ tipo: 'otro' }) }),
  ).rejects.toThrow(/^NO_ENCONTRADO:/)
})

test('storage: el bucket comprobantes es privado', async () => {
  const [b] = await sqlAdmin(`select public from storage.buckets where id = 'comprobantes'`)
  expect(b).toEqual({ public: false })
})


// ---------------------------------------------------------------------------------------
// Controles y duplicados
// ---------------------------------------------------------------------------------------

async function escenarioControles() {
  const f = await preparar()
  await rpc(f.gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: f.empresa, p_importe: 500000000n, p_fecha: '2026-07-01' })
  let n = 0
  const tramite = async (cliente: string, pago: bigint) => {
    n += 1
    const id = (
      await rpc(f.contable, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: f.empresa, p_sucursal: f.sucursal, p_tipo: 'transferencia_usado',
        p_cliente: cliente, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Peugeot 208', p_dominio: 'AA' + n + n + n + 'AA',
      })
    ).rows[0].crear_tramite as string
    await rpc(f.contable, 'autorizar_tramite', { p_tramite: id, p_gestora: f.gestora, p_version: 1 })
    const mov = (
      await rpc(f.gestora, 'registrar_pago', {
        p_idem: randomUUID(), p_tramite: id, p_fecha: FECHA,
        p_arancel: pago, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_es_final: true,
      })
    ).rows[0].registrar_pago as string
    return { id, mov }
  }
  const t1 = await tramite('GODOY MARIO ESTEBAN', 116385524n)
  const t2 = await tramite('JOFRE FABRICIO ALEJANDRO', 43153969n)
  const r = await f.crear(f.contable)
  await rpc(f.contable, 'guardar_filas', {
    p_rendicion: r,
    p_filas: JSON.stringify([
      { nombre: 'GODOY MARIO ESTEBAN', pago_cents: '116385524', honorarios_cents: '3250000', tramite_id: t1.id, vinculo: 'auto' },
      { nombre: 'JOFRE FABRICIO ALEJANDRO', pago_cents: '43153969', honorarios_cents: '3250000', tramite_id: t2.id, vinculo: 'auto' },
    ]),
  })
  const filas = (await sqlAdmin('select id from public.rendicion_filas where rendicion_id = $1 order by orden', [r])).map((x) => x.id as string)
  const comprobante = async (datos: Record<string, unknown>) =>
    (await rpc(f.contable, 'guardar_comprobante', { p_rendicion: r, p_datos: JSON.stringify(datos) })).rows[0].guardar_comprobante as string
  // GODOY = recibo + retención; JOFRE = un recibo. Facturas de honorarios confirmadas.
  await comprobante({ tipo: 'recibo_dnrpa', fila_id: filas[0], numero: '171648', emisor: 'Registro 19008', total_cents: '65524095', archivo_sha256: 'h1', archivo_path: `${r}/h1.pdf` })
  const sellos = await comprobante({ tipo: 'retencion_sellos', fila_id: filas[0], numero: '0000115277', emisor_cuit: '27111111114', total_cents: '50861429', archivo_sha256: 'h2' })
  await comprobante({ tipo: 'recibo_dnrpa', fila_id: filas[1], numero: '171649', emisor: 'Registro 19008', total_cents: '43153969', archivo_sha256: 'h3' })
  await comprobante({ tipo: 'factura_honorarios', fila_id: filas[0], numero: '0001-00010391', total_cents: '3250000', revision: 'confirmado', archivo_sha256: 'h4' })
  const factura2 = await comprobante({ tipo: 'factura_honorarios', fila_id: filas[1], numero: '0001-00010392', total_cents: '3250000', revision: 'confirmado', archivo_sha256: 'h5' })
  const controles = async () =>
    (await rpc(f.contable, 'controles_rendicion', { p_rendicion: r })).rows[0].controles_rendicion
  const duplicados = async () =>
    (await rpc(f.contable, 'comprobantes_duplicados', { p_rendicion: r })).rows
  return { ...f, r, t1, t2, filas, comprobante, sellos, factura2, controles, duplicados, tramite }
}

test('controles: todo coincide, los tres en verde', async () => {
  const e = await escenarioControles()
  const c = await e.controles()
  expect(c.importes).toMatchObject({
    ok: true, total_planilla_cents: '159539493', debitado_habitualista_cents: '159539493', diferencia_cents: '0',
    movimientos_sin_rendir: [],
  })
  expect(c.importes.filas.every((x: { ok: boolean }) => x.ok)).toBe(true)
  expect(c.autorizados).toEqual({ ok: true, filas_no_autorizadas: [] })
  expect(c.honorarios).toMatchObject({
    ok: true, cantidad_tramites: 2, honorario_unitario_cents: '3250000', esperado_cents: '6500000', facturado_cents: '6500000', diferencia_cents: '0',
  })
  // Gerencia también los ve; la gestora no. Calcular no crea movimientos.
  await rpc(e.gerencia, 'controles_rendicion', { p_rendicion: e.r })
  await expect(rpc(e.gestora, 'controles_rendicion', { p_rendicion: e.r })).rejects.toThrow(/^NO_ENCONTRADO:/)
})

test('controles: un peso de más en un comprobante da la diferencia exacta', async () => {
  const e = await escenarioControles()
  await e.comprobante({ id: e.sellos, tipo: 'retencion_sellos', fila_id: e.filas[0], numero: '0000115277', emisor_cuit: '27111111114', total_cents: '50861529' })
  const c = await e.controles()
  expect(c.importes.ok).toBe(false)
  expect(c.importes.filas[0]).toMatchObject({ fila_id: e.filas[0], pago_cents: '116385524', comprobantes_cents: '116385624', diferencia_cents: '100', ok: false })
  expect(c.importes.filas[1].ok).toBe(true)
})

test('control habitualista: un pago del mes de un trámite fuera de la rendición queda sin rendir', async () => {
  const e = await escenarioControles()
  const t3 = await e.tramite('OTRO CLIENTE', 1234500n)
  const c = await e.controles()
  expect(c.importes).toMatchObject({ ok: false, debitado_habitualista_cents: String(159539493 + 1234500), diferencia_cents: '-1234500' })
  expect(c.importes.movimientos_sin_rendir).toEqual([
    expect.objectContaining({ movimiento_id: t3.mov, importe_cents: '1234500', fecha: FECHA }),
  ])
  expect(c.importes.movimientos_sin_rendir[0].tramite_numero).toMatch(/^T-/)
  // Revertido, ya no cuenta.
  await rpc(e.contable, 'revertir_movimiento', { p_idem: randomUUID(), p_movimiento: t3.mov, p_motivo: 'pago duplicado' })
  expect((await e.controles()).importes).toMatchObject({ ok: true, movimientos_sin_rendir: [] })
})

test('control autorizados: una fila sin trámite', async () => {
  const e = await escenarioControles()
  await rpc(e.contable, 'guardar_filas', {
    p_rendicion: e.r,
    p_filas: JSON.stringify([
      { id: e.filas[0], nombre: 'GODOY MARIO ESTEBAN', pago_cents: '116385524', honorarios_cents: '3250000', tramite_id: e.t1.id, vinculo: 'auto' },
      { id: e.filas[1], nombre: 'JOFRE FABRICIO ALEJANDRO', pago_cents: '43153969', honorarios_cents: '3250000', tramite_id: null, vinculo: 'sin_vincular' },
    ]),
  })
  const c = await e.controles()
  expect(c.autorizados).toEqual({
    ok: false, filas_no_autorizadas: [{ fila_id: e.filas[1], nombre: 'JOFRE FABRICIO ALEJANDRO', motivo: 'sin_vincular' }],
  })
})

test('control honorarios: falta una factura', async () => {
  const e = await escenarioControles()
  await e.comprobante({ id: e.factura2, tipo: 'factura_honorarios', revision: 'pendiente', total_cents: '3250000' })
  const c = await e.controles()
  expect(c.honorarios).toMatchObject({ ok: false, facturado_cents: '3250000', diferencia_cents: '-3250000' })
})

test('duplicado por número y por archivo: avisa pero no bloquea', async () => {
  const e = await escenarioControles()
  expect(await e.duplicados()).toEqual([])
  const copia = await e.comprobante({ tipo: 'recibo_dnrpa', numero: '999', emisor: 'X', archivo_sha256: 'h1' })
  const reescaneo = await e.comprobante({ tipo: 'retencion_sellos', numero: '0000115277', emisor_cuit: '27111111114', archivo_sha256: 'h9' })
  const d = await e.duplicados()
  expect(d).toEqual(expect.arrayContaining([
    expect.objectContaining({ comprobante_id: copia, motivo: 'mismo_archivo', otra_rendicion: e.r }),
    expect.objectContaining({ comprobante_id: reescaneo, motivo: 'mismo_numero', otro_id: e.sellos }),
  ]))
  expect(d.find((x) => x.comprobante_id === copia && x.motivo === 'mismo_numero')).toBeUndefined()
})
