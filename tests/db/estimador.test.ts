import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

type Linea = { concepto: string; importe_cents: string | null; verificado: boolean; fuente: string }
type Estimado = { lineas: Linea[]; total_cents: string; confianza: string }

async function calcular(tipo: string, provincia: string, valor: bigint | null, prenda: bigint | null, destino = 'cliente', vehiculo = 'auto') {
  const [r] = await sqlAdmin(
    `select public.calcular_estimado($1, $2, $3, $4, $5, $6, '2026-10-29') as e`,
    [tipo, vehiculo, provincia, valor, prenda, destino],
  )
  return r.e as Estimado
}
const linea = (e: Estimado, concepto: string) => e.lineas.find((l) => l.concepto === concepto)!

test('reproduce el recibo real: 0 km con prenda en San Luis', async () => {
  const e = await calcular('patentamiento_0km', 'San Luis', 3881451657n, 4238452391n)
  expect(linea(e, 'arancel').importe_cents).toBe('38814517')
  expect(linea(e, 'prenda').importe_cents).toBe('4238452')
  expect(linea(e, 'sellos_prenda').importe_cents).toBe('50861429')
  expect(linea(e, 'honorarios').importe_cents).toBe('3250000')
  expect(linea(e, 'sellos_acto').importe_cents).toBeNull()
  expect(e.total_cents).toBe(String(38814517 + 4238452 + 50861429 + 3250000))
  // MRPA a confirmar y sellos del acto sin regla: nunca completo.
  expect(e.confianza).toBe('parcial')
})

test('transferencia: habitualista 08 arancel 0, reventa dentro de 90 días -10 %', async () => {
  const h = await calcular('transferencia_parte_pago', 'San Luis', 1000000000n, null, 'habitualista_08')
  expect(linea(h, 'arancel').importe_cents).toBe('0')
  const r = await calcular('transferencia_usado', 'San Luis', 1000000000n, null, 'reventa_90')
  expect(linea(r, 'arancel').importe_cents).toBe('9000000')
  expect(r.lineas.some((l) => l.concepto === 'prenda')).toBe(false)
})

test('sin valor de referencia: confianza sin_valor; sin regla de sellos: sin dato', async () => {
  const s = await calcular('patentamiento_0km', 'San Luis', null, null)
  expect(s.confianza).toBe('sin_valor')
  expect(linea(s, 'arancel').importe_cents).toBeNull()
  const sj = await calcular('patentamiento_0km', 'San Juan', 1000000000n, 100000000n)
  expect(linea(sj, 'sellos_prenda').importe_cents).toBeNull()
  expect(linea(sj, 'prenda').importe_cents).toBe('100000')
})

test('sellos de prenda San Luis respetan el mínimo de $780', async () => {
  const e = await calcular('patentamiento_0km', 'San Luis', 1000000000n, 100000n)
  expect(linea(e, 'sellos_prenda').importe_cents).toBe('78000')
})

async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [])
  const [{ id: empresa }] = await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`)
  const [{ id: sucursal }] = await sqlAdmin(`select id from public.sucursales where nombre = 'San Luis Capital'`)
  const tramite = (
    await rpc(gerencia, 'crear_tramite', {
      p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
      p_cliente: 'Cliente', p_cuenta_personal: 'CP-1', p_oferta: 'OF-1', p_vehiculo: 'Fiat Cronos', p_dominio: 'AA1BB',
    })
  ).rows[0].crear_tramite as string
  const estimar = (por: string) =>
    rpc(por, 'estimar_tramite', {
      p_tramite: tramite, p_valor: 3881451657n, p_prenda: 4238452391n, p_vehiculo: 'auto', p_destino: 'cliente', p_provincia: null,
    })
  return { gerencia, contable, gestora, tramite, estimar }
}

test('contable con alcance guarda versiones; la gestora no ve ni ejecuta nada', async () => {
  const f = await preparar()
  await f.estimar(f.contable)
  await f.estimar(f.contable)
  const ver = (por: string, tabla: string) => comoUsuario(por, async (c) => (await c.query(`select * from public.${tabla}`)).rows)
  const filas = await ver(f.gerencia, 'estimados')
  expect(filas.map((x) => x.version).sort()).toEqual([1, 2])
  expect(filas[0].total_cents).toBe(97164398n)
  expect(await ver(f.gestora, 'estimados')).toEqual([])
  expect(await ver(f.gestora, 'parametros_estimador')).toEqual([])
  expect((await ver(f.contable, 'parametros_estimador')).length).toBeGreaterThan(0)
  await expect(f.estimar(f.gestora)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(
    comoUsuario(f.gerencia, (c) => c.query(`select public.calcular_estimado('patentamiento_0km','auto','San Luis',1,null,'cliente',current_date)`)),
  ).rejects.toThrow(/permission denied/)
  const comercial = await crearUsuario('comercial', [{ empresa: 'Paris Autos' }])
  await expect(f.estimar(comercial)).rejects.toThrow(/^SIN_PERMISO:/)
})

test('cambiar un parámetro no altera estimados guardados; solo gerencia edita', async () => {
  const f = await preparar()
  await f.estimar(f.gerencia)
  const guardar = (por: string, fuente: string) =>
    rpc(por, 'guardar_parametro_estimador', {
      p_clave: 'honorarios', p_vehiculo: null, p_provincia: null, p_valor: 4000000, p_vigencia_desde: '2026-10-01',
      p_fuente: fuente, p_verificado: true,
    })
  await expect(guardar(f.contable, 'x')).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(guardar(f.gerencia, '  ')).rejects.toThrow(/^DATO_INVALIDO:/)
  await guardar(f.gerencia, 'Acuerdo con la gestora 10/2026')
  await f.estimar(f.gerencia)
  const filas = await sqlAdmin('select version, total_cents from public.estimados order by version')
  expect(filas[1].total_cents - filas[0].total_cents).toBe(750000n)
  const hist = await sqlAdmin(`select vigencia_hasta from public.parametros_estimador where clave = 'honorarios' order by vigencia_desde`)
  expect(hist).toHaveLength(2)
  expect(hist[0].vigencia_hasta).not.toBeNull()
  // MRPA cargado por gerencia: el mínimo se aplica y deja de ser "a confirmar".
  await rpc(f.gerencia, 'guardar_parametro_estimador', {
    p_clave: 'mrpa_pesos', p_vehiculo: null, p_provincia: null, p_valor: 1000000, p_vigencia_desde: '2026-10-01',
    p_fuente: 'Recibo 10/2026', p_verificado: true,
  })
  const e = await calcular('patentamiento_0km', 'San Luis', 100n, null)
  expect(linea(e, 'arancel').importe_cents).toBe('52000000')
})
