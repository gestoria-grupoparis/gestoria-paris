import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const fila = (mtm: string, anio: number, valor: bigint, modelo = 'CRONOS 1.3 DRIVE', marca = 'FIAT') => ({
  tipo_vehiculo: 'auto', mtm, marca, modelo, version: 'SEDAN 4 PUERTAS', anio, valor_cents: String(valor),
})

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [])
  const importar = (por: string, disp: string, desde: string, filas: unknown[], final = true) =>
    rpc(por, 'importar_valuaciones', {
      p_disposicion: disp, p_vigente_desde: desde, p_fuente_url: 'https://www.dnrpa.gov.ar/valuacion/informacion/x.pdf',
      p_filas: JSON.stringify(filas), p_final: final,
    }).then((r) => r.rows[0].importar_valuaciones as { tabla_id: string; filas: number })
  const buscar = (por: string, texto: string, anio: number | null, fecha: string) =>
    rpc(por, 'buscar_vehiculo', { p_texto: texto, p_anio: anio, p_fecha: fecha }).then((r) => r.rows)
  return { gerencia, contable, gestora, importar, buscar }
}

test('importa en dos tandas, las versiones conviven y la búsqueda elige la vigente a la fecha', async () => {
  const f = await preparar()
  const a = await f.importar(f.gerencia, 'Disp. 100/2026', '2026-06-01', [fila('00100001', 0, 2000000000n)], false)
  const b = await f.importar(f.gerencia, 'Disp. 100/2026', '2026-06-01', [fila('00100001', 2025, 1800000000n)], true)
  expect(b).toEqual({ tabla_id: a.tabla_id, filas: 2 })
  // La tanda repetida no duplica ni pisa; una tabla cerrada no admite más filas.
  await expect(f.importar(f.gerencia, 'Disp. 100/2026', '2026-06-01', [fila('00100002', 0, 1n)])).rejects.toThrow(/^DUPLICADO:/)
  await f.importar(f.gerencia, 'Disp. 160/2026', '2026-10-01', [fila('00100001', 0, 2500000000n), fila('00999999', 0, 1n, 'TORO', 'RAM')])

  expect(await sqlAdmin('select count(*)::int as n from public.valuaciones_tablas')).toEqual([{ n: 2 }])
  const junio = await f.buscar(f.contable, 'fiat cronos', 0, '2026-09-30')
  expect(junio.map((x) => [x.disposicion, x.valor_cents])).toEqual([['Disp. 100/2026', 2000000000n]])
  const octubre = await f.buscar(f.contable, 'cronos drive', null, '2026-10-29')
  expect(octubre.map((x) => [x.disposicion, x.mtm, x.anio, x.valor_cents])).toEqual([['Disp. 160/2026', '00100001', 0, 2500000000n]])
  expect(await f.buscar(f.contable, 'cronos', 0, '2026-01-01')).toEqual([])
})

test('solo gerencia importa; la gestora no ve ni busca', async () => {
  const f = await preparar()
  await expect(f.importar(f.contable, 'Disp. 1/2026', '2026-01-01', [fila('1', 0, 1n)])).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(f.importar(f.gerencia, ' ', '2026-01-01', [fila('1', 0, 1n)])).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(f.importar(f.gerencia, 'Disp. 1/2026', '2026-01-01', [{ ...fila('1', 0, 1n), valor_cents: '-5' }])).rejects.toThrow(/^DATO_INVALIDO:/)
  await f.importar(f.gerencia, 'Disp. 1/2026', '2026-01-01', [fila('00100001', 0, 1000n)])
  const ver = (por: string, t: string) => comoUsuario(por, async (c) => (await c.query(`select * from public.${t}`)).rows)
  expect(await ver(f.gestora, 'valuaciones')).toEqual([])
  expect(await ver(f.gestora, 'valuaciones_tablas')).toEqual([])
  expect(await ver(f.contable, 'valuaciones')).toHaveLength(1)
  await expect(f.buscar(f.gestora, 'fiat', null, '2026-10-29')).rejects.toThrow(/^SIN_PERMISO:/)
})

test('el estimado usa el mayor entre el valor declarado y la valuación, y deja constancia', async () => {
  const f = await preparar()
  const { tabla_id } = await f.importar(f.gerencia, 'Disp. 160/2026', '2026-10-01', [fila('00100001', 2020, 1500000000n)])
  const [{ id: empresa }] = await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`)
  const [{ id: sucursal }] = await sqlAdmin(`select id from public.sucursales where nombre = 'San Luis Capital'`)
  const tramite = (
    await rpc(f.gerencia, 'crear_tramite', {
      p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'transferencia_usado',
      p_cliente: 'Cliente', p_cuenta_personal: 'CP-1', p_oferta: 'OF-1', p_vehiculo: 'Fiat Cronos', p_dominio: 'AA1BB',
    })
  ).rows[0].crear_tramite as string
  const estimar = (valor: bigint | null, mtm: string | null) =>
    rpc(f.contable, 'estimar_tramite', {
      p_tramite: tramite, p_valor: valor, p_prenda: null, p_vehiculo: 'auto', p_destino: 'cliente', p_provincia: null,
      p_tabla: mtm ? tabla_id : null, p_mtm: mtm, p_anio: mtm ? 2020 : null,
    })
  const arancel = async () => {
    const [e] = await sqlAdmin('select entrada, lineas from public.estimados where tramite_id = $1 order by version desc limit 1', [tramite])
    return { entrada: e.entrada, l: e.lineas.find((x: { concepto: string }) => x.concepto === 'arancel') }
  }
  await estimar(1000000000n, '00100001')
  let a = await arancel()
  expect(a.l.base_cents).toBe('1500000000')
  expect(a.l.valuacion).toBe('Valuación DNRPA Disp. 160/2026 — 00100001 (2020)')
  expect(a.entrada).toMatchObject({ mtm: '00100001', anio: 2020, valuacion_cents: '1500000000', tabla_id })

  await estimar(2000000000n, '00100001')
  expect((await arancel()).l.base_cents).toBe('2000000000')

  await estimar(null, '00100001')
  a = await arancel()
  expect(a.l.importe_cents).not.toBeNull()

  await estimar(1000000000n, null)
  a = await arancel()
  expect(a.l.base_cents).toBe('1000000000')
  expect(a.l.valuacion).toBeUndefined()

  await expect(estimar(1n, '99999999')).rejects.toThrow(/^DATO_INVALIDO:/)
})
