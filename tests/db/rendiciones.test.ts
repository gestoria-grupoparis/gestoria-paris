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

  const crear = async (por: string, periodo = PERIODO) =>
    (await rpc(por, 'crear_rendicion', { p_empresa: empresa, p_periodo: periodo, p_honorario: 3250000n }))
      .rows[0].crear_rendicion as string
  const estado = (por: string, id: string, hacia: string, version: number, motivo: string | null = null) =>
    rpc(por, 'cambiar_estado_rendicion', { p_rendicion: id, p_estado: hacia, p_motivo: motivo, p_version: version })
  const ver = (por: string) =>
    comoUsuario(por, async (c) => (await c.query('select id, estado, version from public.rendiciones')).rows)

  return { gerencia, contable, ajena, gestora, otraGestora, empresa, sucursal, crear, estado, ver }
}

test('gestora crea su rendición y otra gestora no la ve', async () => {
  const f = await preparar()
  const id = await f.crear(f.gestora)
  expect(await f.ver(f.gestora)).toEqual([{ id, estado: 'borrador', version: 1 }])
  expect(await f.ver(f.otraGestora)).toEqual([])
  expect(await f.ver(f.contable)).toHaveLength(1)
  // gerencia elige la gestora; sin gestora es dato inválido.
  await expect(
    rpc(f.gerencia, 'crear_rendicion', { p_empresa: f.empresa, p_periodo: '2026-08-01', p_honorario: 3250000n }),
  ).rejects.toThrow(/^DATO_INVALIDO:/)
  const otra = (
    await rpc(f.gerencia, 'crear_rendicion', {
      p_empresa: f.empresa, p_periodo: '2026-08-01', p_honorario: 3250000n, p_gestora: f.otraGestora,
    })
  ).rows[0].crear_rendicion
  expect(await f.ver(f.otraGestora)).toEqual([{ id: otra, estado: 'borrador', version: 1 }])
})

test('contable sin alcance no ve la rendición de Paris Autos', async () => {
  const f = await preparar()
  await f.crear(f.gestora)
  expect(await f.ver(f.ajena)).toEqual([])
  const comercial = await crearUsuario('comercial', [{ empresa: 'Paris Autos' }])
  expect(await f.ver(comercial)).toEqual([])
  await expect(f.crear(comercial)).rejects.toThrow(/^SIN_PERMISO:/)
})

test('una rendición aprobada no se edita (TRANSICION_INVALIDA)', async () => {
  const f = await preparar()
  const id = await f.crear(f.gestora)
  await rpc(f.gestora, 'guardar_filas', {
    p_rendicion: id,
    p_filas: JSON.stringify([{ nombre: 'GODOY MARIO', pago_cents: '116385524', honorarios_cents: '3250000' }]),
  })
  await f.estado(f.gestora, id, 'enviada', 1)
  // enviada: la gestora ya no edita.
  await expect(rpc(f.gestora, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await f.estado(f.contable, id, 'aprobada', 2)
  await expect(rpc(f.gestora, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(
    rpc(f.gestora, 'guardar_comprobante', { p_rendicion: id, p_datos: JSON.stringify({ tipo: 'otro' }) }),
  ).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(f.estado(f.contable, id, 'observada', 3, 'x')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  // Ni siquiera aprobar una rendición crea movimientos.
  expect(await sqlAdmin('select count(*)::int as n from public.movimientos')).toEqual([{ n: 0 }])
})

test('observar exige motivo y devuelve a la gestora', async () => {
  const f = await preparar()
  const id = await f.crear(f.gestora)
  await f.estado(f.gestora, id, 'enviada', 1)
  await expect(f.estado(f.contable, id, 'observada', 2)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(f.estado(f.gestora, id, 'aprobada', 2)).rejects.toThrow(/^SIN_PERMISO:/)
  await f.estado(f.contable, id, 'observada', 2, 'falta la factura de GODOY')
  const [r] = await sqlAdmin('select estado, motivo_observacion from public.rendiciones where id = $1', [id])
  expect(r).toEqual({ estado: 'observada', motivo_observacion: 'falta la factura de GODOY' })
  // vuelve a editar y reenvía.
  await rpc(f.gestora, 'guardar_filas', { p_rendicion: id, p_filas: '[]' })
  await f.estado(f.gestora, id, 'enviada', 3)
})

test('versión vieja da VERSION_CONFLICTO', async () => {
  const f = await preparar()
  const id = await f.crear(f.gestora)
  await f.estado(f.gestora, id, 'enviada', 1)
  await expect(f.estado(f.contable, id, 'aprobada', 1)).rejects.toThrow(/^VERSION_CONFLICTO:/)
})

test('no se puede crear dos rendiciones del mismo mes para la misma gestora y empresa (DUPLICADO)', async () => {
  const f = await preparar()
  await f.crear(f.gestora)
  await expect(f.crear(f.gestora, '2026-07-20')).rejects.toThrow(/^DUPLICADO:/)
})

test('guardar_comprobante guarda las líneas y lo audita', async () => {
  const f = await preparar()
  const id = await f.crear(f.gestora)
  const c = (
    await rpc(f.gestora, 'guardar_comprobante', {
      p_rendicion: id,
      p_datos: JSON.stringify({
        tipo: 'recibo_dnrpa', archivo_path: `${id}/abc.pdf`, archivo_sha256: 'abc', numero: '171648',
        total_cents: '43153969', revision: 'pendiente',
        lineas: [{ concepto: 'Arancel', importe_cents: '43683969' }, { concepto: 'Bonif', importe_cents: '-530000' }],
      }),
    })
  ).rows[0].guardar_comprobante as string
  const lineas = await sqlAdmin('select importe_cents from public.comprobante_lineas where comprobante_id = $1 order by importe_cents', [c])
  expect(lineas.map((l) => l.importe_cents)).toEqual([-530000n, 43683969n])
  // upsert por id: reemplaza las líneas
  await rpc(f.gestora, 'guardar_comprobante', {
    p_rendicion: id,
    p_datos: JSON.stringify({ id: c, tipo: 'recibo_dnrpa', revision: 'confirmado', lineas: [] }),
  })
  expect(await sqlAdmin('select count(*)::int as n from public.comprobante_lineas')).toEqual([{ n: 0 }])
  const [cmp] = await sqlAdmin('select revision, revisado_por from public.comprobantes where id = $1', [c])
  expect(cmp).toEqual({ revision: 'confirmado', revisado_por: f.gestora })
  const ev = await sqlAdmin(`select count(*)::int as n from public.eventos where entidad = 'comprobantes'`)
  expect(ev[0].n).toBeGreaterThan(0)
  // otra gestora no puede
  await expect(
    rpc(f.otraGestora, 'guardar_comprobante', { p_rendicion: id, p_datos: JSON.stringify({ tipo: 'otro' }) }),
  ).rejects.toThrow(/^(SIN_PERMISO|NO_ENCONTRADO):/)
})

test('storage: el bucket comprobantes es privado', async () => {
  const [b] = await sqlAdmin(`select public from storage.buckets where id = 'comprobantes'`)
  expect(b).toEqual({ public: false })
})

