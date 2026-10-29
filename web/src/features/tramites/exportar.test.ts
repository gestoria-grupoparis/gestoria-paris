import { describe, expect, it } from 'vitest'
import type { TramiteFila } from './consultas'
import { centavosADecimal, COLUMNAS_CSV, columnasTramites, nombreArchivo, tramitesACsv } from './exportar'

const fila = (extra: Partial<TramiteFila> = {}): TramiteFila => ({
  id: 't1', numero: 'T-2026-00001', created_at: '2026-10-20T13:00:00Z', estado: 'autorizado',
  vehiculo_desc: 'Peugeot 208; Allure', dominio: 'AB123CD', chasis: null, version: 1,
  autorizado_at: '2026-10-21T10:00:00Z', gestora_id: 'g1', empresa_id: 'e1', sucursal_id: 's1',
  tipo: { codigo: 'PAT', nombre: 'Patentamiento 0 km' },
  operacion: {
    cliente_nombre: 'María "Mary" Gómez', cuenta_personal: 'CP-7788', oferta_ref: 'OF-5521',
    empresa: { nombre: 'Paris Autos' }, sucursal: { nombre: 'Casa central', provincia: 'San Luis' },
  },
  finanzas: { presupuesto: '65000050', pagado: null, situacion: 'sin_fondos' },
  ...extra,
})

describe('centavosADecimal', () => {
  it('convierte sin aritmética y respeta signo y ceros', () => {
    expect(centavosADecimal('65000050')).toBe('650000,50')
    expect(centavosADecimal('5')).toBe('0,05')
    expect(centavosADecimal('-120000')).toBe('-1200,00')
    expect(centavosADecimal('-0')).toBe('0,00')
    expect(centavosADecimal('123456789012345678901')).toBe('1234567890123456789,01')
    expect(centavosADecimal(null)).toBe('')
    expect(() => centavosADecimal('1.5')).toThrow()
  })
})

describe('tramitesACsv', () => {
  it('arma encabezado, separa con ; y escapa comillas y separadores', () => {
    const csv = tramitesACsv([fila()], () => 'Gabriela Gestora')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const [enc, linea] = csv.slice(1).split('\r\n')
    expect(enc.split(';')).toEqual(COLUMNAS_CSV)
    expect(linea).toContain('"María ""Mary"" Gómez"')
    expect(linea).toContain('"Peugeot 208; Allure"')
    expect(linea).toContain(';Autorizado;')
    expect(linea).toContain(';Gabriela Gestora;2026-10-21;650000,50;;Sin fondos')
  })

  it('neutraliza textos que Excel tomaría como fórmula', () => {
    const csv = tramitesACsv([fila({ vehiculo_desc: '=HYPERLINK("x")', gestora_id: null, finanzas: null })], () => '?')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.trimEnd().endsWith(';;2026-10-21;;;')).toBe(true)
  })

  it('nombra el archivo con la fecha', () => {
    expect(nombreArchivo('2026-10-28')).toBe('tramites-2026-10-28.csv')
    expect(nombreArchivo('2026-10-28', 'xlsx')).toBe('tramites-2026-10-28.xlsx')
  })

  it('marca presupuesto y pagado como columnas de moneda para el XLSX', () => {
    const cols = columnasTramites(() => 'G')
    expect(cols.map((c) => c.titulo)).toEqual(COLUMNAS_CSV)
    expect(cols.filter((c) => c.moneda).map((c) => c.titulo)).toEqual(['Presupuesto', 'Pagado'])
  })
})
