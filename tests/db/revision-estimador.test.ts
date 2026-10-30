import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

type Linea = { concepto: string; importe_cents: string | null }
type Estimado = { lineas: Linea[]; total_cents: string | null; confianza: string }
const calcular = async (tipo: string, valor: bigint, prenda: bigint | null, destino = 'cliente') =>
  (await sqlAdmin(`select public.calcular_estimado($1, 'auto', 'San Luis', $2, $3, $4, '2026-10-29') as e`, [tipo, valor, prenda, destino]))[0].e as Estimado
const linea = (e: Estimado, c: string) => e.lineas.find((l) => l.concepto === c)!

test('parámetro sin valor o inexistente: la línea queda sin dato, fuera del total, y nunca completo', async () => {
  await sqlAdmin(`update public.parametros_estimador set valor = null where clave in ('transferencia_pct', 'prenda_por_mil')`)
  const t = await calcular('transferencia_usado', 1000000000n, 100000000n)
  expect(linea(t, 'arancel').importe_cents).toBeNull()
  expect(linea(t, 'prenda').importe_cents).toBeNull()
  expect(t.total_cents).not.toBeNull()
  expect(t.total_cents).toBe(String(BigInt(linea(t, 'honorarios').importe_cents!) + BigInt(linea(t, 'sellos_prenda').importe_cents ?? '0')))
  expect(t.confianza).toBe('parcial')

  await sqlAdmin(`delete from public.parametros_estimador where clave = 'reventa_descuento_pct'`)
  await sqlAdmin(`update public.parametros_estimador set valor = 1 where clave = 'transferencia_pct'`)
  const r = await calcular('transferencia_usado', 1000000000n, null, 'reventa_90')
  expect(linea(r, 'arancel').importe_cents).toBeNull()
  expect(r.total_cents).toBe(linea(r, 'honorarios').importe_cents)
  expect(r.confianza).toBe('parcial')
})

test('parámetro cargado con vigencia anterior a otro posterior: cierra el previo y el nuevo termina antes del siguiente', async () => {
  const g = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const guardar = (desde: string, valor: number) => rpc(g, 'guardar_parametro_estimador', {
    p_clave: 'honorarios', p_vehiculo: null, p_provincia: null, p_valor: valor, p_vigencia_desde: desde, p_fuente: 'x', p_verificado: true,
  })
  await guardar('2026-12-01', 5000000)
  await guardar('2026-10-15', 4000000)
  const filas = await sqlAdmin(`select to_char(vigencia_desde, 'YYYY-MM-DD') d, to_char(vigencia_hasta, 'YYYY-MM-DD') h
                                  from public.parametros_estimador where clave = 'honorarios' order by vigencia_desde`)
  expect(filas.map((f) => [f.d, f.h])).toEqual([['2026-09-01', '2026-10-14'], ['2026-10-15', '2026-11-30'], ['2026-12-01', null]])
})

const fila = (mtm: string) => ({ tipo_vehiculo: 'auto', mtm, marca: 'FIAT', modelo: 'CRONOS', version: 'SEDAN', anio: 2020, valor_cents: '1500000000' })

test('importar: dos primeras tandas simultáneas con la misma clave no chocan', async () => {
  const g = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const imp = (mtm: string) => rpc(g, 'importar_valuaciones', {
    p_disposicion: 'Disp. 1/2026', p_vigente_desde: '2026-01-01', p_fuente_url: null, p_filas: JSON.stringify([fila(mtm)]), p_final: false,
  })
  await Promise.all([imp('1'), imp('2')])
  await imp('3')
  expect(await sqlAdmin('select count(*)::int n from public.valuaciones_tablas')).toEqual([{ n: 1 }])
  expect(await sqlAdmin('select count(*)::int n from public.valuaciones')).toEqual([{ n: 3 }])
})

test('el estimado rechaza una tabla incompleta o que no es la vigente', async () => {
  const g = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const imp = (disp: string, desde: string, final: boolean) => rpc(g, 'importar_valuaciones', {
    p_disposicion: disp, p_vigente_desde: desde, p_fuente_url: null, p_filas: JSON.stringify([fila('00100001')]), p_final: final,
  }).then((r) => r.rows[0].importar_valuaciones.tabla_id as string)
  const vieja = await imp('Disp. 1/2026', '2026-01-01', true)
  const incompleta = await imp('Disp. 2/2026', '2026-02-01', false)
  const vigente = await imp('Disp. 3/2026', '2026-03-01', true)
  const [{ id: empresa }] = await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`)
  const [{ id: sucursal }] = await sqlAdmin(`select id from public.sucursales where nombre = 'San Luis Capital'`)
  const tramite = (await rpc(g, 'crear_tramite', {
    p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'transferencia_usado',
    p_cliente: 'C', p_cuenta_personal: 'CP', p_oferta: 'OF', p_vehiculo: 'Fiat', p_dominio: 'AA1BB',
  })).rows[0].crear_tramite as string
  const estimar = (tabla: string) => rpc(g, 'estimar_tramite', {
    p_tramite: tramite, p_valor: null, p_prenda: null, p_vehiculo: 'auto', p_destino: 'cliente', p_provincia: null,
    p_tabla: tabla, p_mtm: '00100001', p_anio: 2020,
  })
  await expect(estimar(vieja)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(estimar(incompleta)).rejects.toThrow(/^DATO_INVALIDO:/)
  await estimar(vigente)
})
