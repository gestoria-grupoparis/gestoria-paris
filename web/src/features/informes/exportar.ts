import type { Columna } from '../../lib/planilla'
import { etiquetaEstado } from '../tramites/filtros'
import type { CierreMensual, CostoTramite } from './consultas'
import { etiquetaMes } from './meses'

export const COLUMNAS_CIERRE_PLANILLA: Columna<CierreMensual>[] = [
  { titulo: 'Mes', valor: (f) => etiquetaMes(f.mes), ancho: 16 },
  { titulo: 'Razón social', valor: (f) => f.empresa, ancho: 22 },
  { titulo: 'Saldo inicial', valor: (f) => f.saldo_inicial, moneda: true, ancho: 18 },
  { titulo: 'Cargas', valor: (f) => f.cargas, moneda: true, ancho: 16 },
  { titulo: 'Pagos', valor: (f) => f.pagos, moneda: true, ancho: 16 },
  { titulo: 'Ajustes', valor: (f) => f.ajustes, moneda: true, ancho: 16 },
  { titulo: 'Reintegros', valor: (f) => f.reintegros, moneda: true, ancho: 16 },
  { titulo: 'Reversiones', valor: (f) => f.reversiones, moneda: true, ancho: 16 },
  { titulo: 'Saldo final', valor: (f) => f.saldo_final, moneda: true, ancho: 18 },
  { titulo: 'Movimientos', valor: (f) => String(f.movimientos), ancho: 13 },
]

export const COLUMNAS_COSTOS_PLANILLA: Columna<CostoTramite>[] = [
  { titulo: 'Trámite', valor: (f) => f.numero, ancho: 16 },
  { titulo: 'Razón social', valor: (f) => f.empresa, ancho: 20 },
  { titulo: 'Sucursal', valor: (f) => f.sucursal, ancho: 16 },
  { titulo: 'Tipo', valor: (f) => f.tipo, ancho: 22 },
  { titulo: 'Cliente', valor: (f) => f.cliente, ancho: 26 },
  { titulo: 'Gestora', valor: (f) => f.gestora, ancho: 20 },
  { titulo: 'Estado', valor: (f) => etiquetaEstado(f.estado), ancho: 18 },
  { titulo: 'Presupuesto', valor: (f) => f.presupuesto, moneda: true, ancho: 16 },
  { titulo: 'Costo del mes', valor: (f) => f.costo_mes, moneda: true, ancho: 16 },
  { titulo: 'Pagado total', valor: (f) => f.pagado_total, moneda: true, ancho: 16 },
  { titulo: 'Pago final', valor: (f) => (f.pago_final ? 'Sí' : 'No'), ancho: 11 },
  { titulo: 'Desvío', valor: (f) => f.desvio, moneda: true, ancho: 16 },
  { titulo: 'Desvío %', valor: (f) => f.desvio_pct?.replace('.', ','), ancho: 11 },
]
