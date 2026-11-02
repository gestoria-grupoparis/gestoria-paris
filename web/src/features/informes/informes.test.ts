import { describe, expect, it } from 'vitest'
import { planillaACsv } from '../../lib/planilla'
import type { CierreMensual, CostoTramite } from './consultas'
import { COLUMNAS_CIERRE_PLANILLA, COLUMNAS_COSTOS_PLANILLA } from './exportar'
import { esCero, etiquetaMes, mesesRecientes, primerDiaDelMes, tonoDesvio } from './meses'

describe('meses del informe', () => {
  it('lista los últimos meses desde el mes de hoy, del más reciente al más viejo', () => {
    expect(mesesRecientes('2026-10-29', 3)).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(mesesRecientes('2026-01-05', 2)).toEqual(['2026-01', '2025-12'])
  })
  it('etiqueta y primer día sin pasar por Date', () => {
    expect(etiquetaMes('2026-10')).toBe('Octubre 2026')
    expect(primerDiaDelMes('2026-03')).toBe('2026-03-01')
  })
  it('tono del desvío según signo', () => {
    expect(tonoDesvio('3000')).toBe('sinfondos')
    expect(tonoDesvio('-1')).toBe('disponible')
    expect(tonoDesvio('0')).toBe('neutro')
    expect(tonoDesvio(null)).toBe('apagado')
  })
})

const cierre: CierreMensual = {
  mes: '2026-10-01', empresa_id: 'e1', empresa: 'Paris Autos', cuenta_id: 'c1', saldo_inicial: '100000000',
  cargas: '50000000', pagos: '32000050', ajustes: '-1000', reintegros: '2000', reversiones: '0', saldo_final: '117999950', movimientos: 4,
}
const costo: CostoTramite = {
  mes: '2026-10-01', tramite_id: 't1', numero: 'T-2026-00021', empresa_id: 'e1', empresa: 'Paris Autos', sucursal: 'San Luis',
  tipo: 'Patentamiento 0km', cliente: 'Héctor Ponce', gestora: 'Gabriela Gestora', estado: 'presentado',
  presupuesto: '30000000', costo_mes: '23000000', pagado_total: '33000000', pago_final: true, desvio: '3000000', desvio_pct: '10.00',
}

describe('informes a planilla', () => {
  it('exporta el cierre mensual con montos numéricos', () => {
    const [enc, l1] = planillaACsv(COLUMNAS_CIERRE_PLANILLA, [cierre]).slice(1).split('\r\n')
    expect(enc).toBe('Mes;Razón social;Saldo inicial;Cargas;Pagos;Ajustes;Reintegros;Reversiones;Saldo final;Movimientos')
    expect(l1).toBe('Octubre 2026;Paris Autos;1000000,00;500000,00;320000,50;-10,00;20,00;0,00;1179999,50;4')
  })
  it('exporta costos con desvío y porcentaje con coma', () => {
    const [enc, l1, l2] = planillaACsv(COLUMNAS_COSTOS_PLANILLA, [costo, { ...costo, pago_final: false, desvio: null, desvio_pct: null, presupuesto: null }])
      .slice(1).split('\r\n')
    expect(enc).toBe('Trámite;Razón social;Sucursal;Tipo;Cliente;Gestora;Estado;Presupuesto;Costo del mes;Pagado total;Pago final;Desvío;Desvío %')
    expect(l1).toBe('T-2026-00021;Paris Autos;San Luis;Patentamiento 0km;Héctor Ponce;Gabriela Gestora;Presentado;300000,00;230000,00;330000,00;Sí;30000,00;10,00')
    expect(l2).toBe('T-2026-00021;Paris Autos;San Luis;Patentamiento 0km;Héctor Ponce;Gabriela Gestora;Presentado;;230000,00;330000,00;No;;')
  })
})

describe('ceros sin color', () => {
  it('reconoce el cero en centavos, con o sin signo', () => {
    expect(['0', '000', '-0'].map(esCero)).toEqual([true, true, true])
    expect(['1', '-100', '10'].map(esCero)).toEqual([false, false, false])
  })
})
