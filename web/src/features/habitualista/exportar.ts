import type { Columna } from '../../lib/planilla'
import { TIPOS_MOVIMIENTO, type Movimiento } from './consultas'
import { fechaOperativa } from './saldos'

const siHay = (cents: string) => (cents === '0' ? null : cents)

export const COLUMNAS_EXTRACTO_PLANILLA: Columna<Movimiento>[] = [
  { titulo: 'Fecha', valor: (m) => fechaOperativa(m.fecha_operacion), ancho: 12 },
  { titulo: 'Movimiento', valor: (m) => TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo, ancho: 14 },
  { titulo: 'Trámite', valor: (m) => m.tramite_numero, ancho: 16 },
  { titulo: 'Cliente', valor: (m) => m.cliente, ancho: 28 },
  { titulo: 'Responsable', valor: (m) => m.responsable, ancho: 22 },
  { titulo: 'Ingreso', valor: (m) => siHay(m.ingreso), moneda: true, ancho: 16 },
  { titulo: 'Egreso', valor: (m) => siHay(m.egreso), moneda: true, ancho: 16 },
  { titulo: 'Saldo', valor: (m) => m.saldo, moneda: true, ancho: 18 },
  { titulo: 'Conciliado', valor: (m) => (m.conciliado ? 'Sí' : 'No'), ancho: 12 },
]
