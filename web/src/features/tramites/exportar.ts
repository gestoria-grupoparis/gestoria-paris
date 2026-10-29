import type { TramiteFila } from './consultas'
import { etiquetaEstado, SITUACIONES } from './filtros'
import { planillaACsv, type Columna } from '../../lib/planilla'

export { centavosADecimal } from '../../lib/planilla'

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

export function columnasTramites(nombreGestora: (id: string | null) => string): Columna<TramiteFila>[] {
  return [
    { titulo: 'Número', valor: (t) => t.numero, ancho: 16 },
    { titulo: 'Fecha de alta', valor: (t) => fecha(t.created_at), ancho: 14 },
    { titulo: 'Estado', valor: (t) => etiquetaEstado(t.estado), ancho: 18 },
    { titulo: 'Tipo', valor: (t) => t.tipo.nombre, ancho: 24 },
    { titulo: 'Cliente', valor: (t) => t.operacion.cliente_nombre, ancho: 28 },
    { titulo: 'Cuenta personal', valor: (t) => t.operacion.cuenta_personal },
    { titulo: 'Oferta', valor: (t) => t.operacion.oferta_ref },
    { titulo: 'Vehículo', valor: (t) => t.vehiculo_desc, ancho: 28 },
    { titulo: 'Dominio', valor: (t) => t.dominio ?? '' },
    { titulo: 'Razón social', valor: (t) => t.operacion.empresa.nombre, ancho: 20 },
    { titulo: 'Sucursal', valor: (t) => t.operacion.sucursal.nombre, ancho: 18 },
    { titulo: 'Provincia', valor: (t) => t.operacion.sucursal.provincia },
    { titulo: 'Gestora', valor: (t) => (t.gestora_id ? nombreGestora(t.gestora_id) : ''), ancho: 20 },
    { titulo: 'Autorizado', valor: (t) => fecha(t.autorizado_at), ancho: 14 },
    { titulo: 'Presupuesto', valor: (t) => t.finanzas?.presupuesto, moneda: true, ancho: 16 },
    { titulo: 'Pagado', valor: (t) => t.finanzas?.pagado, moneda: true, ancho: 16 },
    {
      titulo: 'Situación de fondos', ancho: 20,
      valor: (t) => { const sit = t.finanzas?.situacion; return sit && sit !== 'no_aplica' ? (SITUACIONES[sit] ?? sit) : '' },
    },
  ]
}

export const COLUMNAS_CSV = columnasTramites(() => '').map((c) => c.titulo)

/** CSV con `;` (lo que Excel espera en configuración regional argentina), BOM UTF-8 y fin de línea CRLF. */
export function tramitesACsv(filas: TramiteFila[], nombreGestora: (id: string | null) => string): string {
  return planillaACsv(columnasTramites(nombreGestora), filas)
}

export function nombreArchivo(hoy: string, extension: 'csv' | 'xlsx' = 'csv'): string {
  return `tramites-${hoy}.${extension}`
}
