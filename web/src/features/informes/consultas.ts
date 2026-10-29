import { supabase } from '../../lib/supabase'

// Informes calculados en la base (RPC con alcance). Los importes se piden ::text: el front solo formatea.

export interface CierreMensual {
  mes: string
  empresa_id: string
  empresa: string
  cuenta_id: string
  saldo_inicial: string
  cargas: string
  pagos: string
  ajustes: string
  reintegros: string
  reversiones: string
  saldo_final: string
  movimientos: number
}

export interface CostoTramite {
  mes: string
  tramite_id: string
  numero: string
  empresa_id: string
  empresa: string
  sucursal: string
  tipo: string
  cliente: string
  gestora: string | null
  estado: string
  presupuesto: string | null
  costo_mes: string
  pagado_total: string
  pago_final: boolean
  desvio: string | null
  desvio_pct: string | null
}

const SELECT_CIERRE =
  'mes,empresa_id,empresa,cuenta_id,saldo_inicial:saldo_inicial_cents::text,cargas:cargas_cents::text,' +
  'pagos:pagos_cents::text,ajustes:ajustes_cents::text,reintegros:reintegros_cents::text,' +
  'reversiones:reversiones_cents::text,saldo_final:saldo_final_cents::text,movimientos'

const SELECT_COSTOS =
  'mes,tramite_id,numero,empresa_id,empresa,sucursal,tipo,cliente,gestora,estado,presupuesto:presupuesto_cents::text,' +
  'costo_mes:costo_mes_cents::text,pagado_total:pagado_total_cents::text,pago_final,desvio:desvio_cents::text,' +
  'desvio_pct:desvio_pct::text'

const args = (mes: string, empresa: string | null) => ({ p_mes: mes, p_empresa: empresa })

export async function informeCierre(mes: string, empresa: string | null): Promise<CierreMensual[]> {
  const { data, error } = await supabase.rpc('informe_cierre_mensual', args(mes, empresa)).select(SELECT_CIERRE)
  if (error) throw error
  return (data ?? []) as unknown as CierreMensual[]
}

export async function informeCostos(mes: string, empresa: string | null): Promise<CostoTramite[]> {
  const { data, error } = await supabase.rpc('informe_costos_tramites', args(mes, empresa)).select(SELECT_COSTOS)
  if (error) throw error
  return (data ?? []) as unknown as CostoTramite[]
}
