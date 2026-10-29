import { describe, expect, it } from 'vitest'
import { planillaACsv } from '../../lib/planilla'
import type { Movimiento } from './consultas'
import { COLUMNAS_EXTRACTO_PLANILLA } from './exportar'

const mov = (extra: Partial<Movimiento> = {}): Movimiento => ({
  movimiento_id: 'm1', fecha_operacion: '2026-10-20', tipo: 'pago_tramite', tramite_numero: 'T-2026-00001',
  cliente: 'María Gómez', responsable: 'Carla Contable', ingreso: '0', egreso: '6500050', saldo: '93499950',
  conciliado: false, revierte: null, revertidoPor: null, ...extra,
})

describe('extracto a planilla', () => {
  it('exporta fecha, tipo, trámite, montos y estado de conciliación', () => {
    const csv = planillaACsv(COLUMNAS_EXTRACTO_PLANILLA, [mov(), mov({ tipo: 'carga', ingreso: '100000000', egreso: '0', tramite_numero: null, cliente: null, conciliado: true })])
    const [enc, l1, l2] = csv.slice(1).split('\r\n')
    expect(enc).toBe('Fecha;Movimiento;Trámite;Cliente;Responsable;Ingreso;Egreso;Saldo;Conciliado')
    expect(l1).toBe('20/10/2026;Pago;T-2026-00001;María Gómez;Carla Contable;;65000,50;934999,50;No')
    expect(l2).toBe('20/10/2026;Carga;;;Carla Contable;1000000,00;;934999,50;Sí')
    expect(COLUMNAS_EXTRACTO_PLANILLA.filter((c) => c.moneda).map((c) => c.titulo)).toEqual(['Ingreso', 'Egreso', 'Saldo'])
  })
})
