import { supabase } from '../../lib/supabase'

// RPC y tablas del módulo interno de análisis y estimador (solo gerencia y contable).
// Los montos llegan en centavos como texto: el front solo formatea.

export interface Porcion { etiqueta: string; cents: string }

export interface Analisis {
  granularidad: 'dia' | 'semana'
  kpis: {
    gasto_cents: string
    gasto_anterior_cents: string
    variacion_pct: number | null
    estimado_pendiente_cents: string
    honorarios_cents: string
    tramites: { patentamiento_0km: number; transferencia_usado: number; transferencia_parte_pago: number }
  }
  serie: { fecha: string; gasto_cents: string }[]
  semanas: { semana: string; tramites: number }[]
  por_tipo: Porcion[]
  por_empresa: Porcion[]
  por_concepto: Porcion[]
}

export interface Prevision {
  semanas_historia: number
  suficiente: boolean
  sin_monto: number
  semanas: { semana: string; pipeline_cents: string; base_cents: string | null; misma_semana_cents: string | null; alto_cents: string | null; previsto_cents: string }[]
  saldos: { empresa_id: string; empresa: string; registrado_cents: string; disponible_cents: string; previsto_1_cents: string; previsto_2_cents: string; previsto_4_cents: string; alerta: boolean }[]
}

export interface LineaEstimado {
  concepto: string
  base_cents: string | null
  regla: string
  importe_cents: string | null
  fuente: string
  verificado: boolean
}

export interface Estimado {
  id: string
  version: number
  entrada: { valor_cents: string | null; prenda_cents: string | null; vehiculo: string; destino: string; provincia: string }
  lineas: LineaEstimado[]
  total: string
  confianza: 'completo' | 'parcial' | 'sin_valor'
  created_at: string
}

export interface Parametro {
  id: string
  clave: string
  vehiculo: string | null
  provincia: string | null
  valor: string | null
  vigencia_desde: string
  vigencia_hasta: string | null
  fuente: string
  verificado: boolean
}

export interface FiltrosAnalisis { desde: string; hasta: string; empresa: string | null; sucursal: string | null; tipo: string | null }

export async function obtenerAnalisis(f: FiltrosAnalisis): Promise<Analisis> {
  const { data, error } = await supabase.rpc('analisis_gastos', {
    p_desde: f.desde, p_hasta: f.hasta, p_empresa: f.empresa, p_sucursal: f.sucursal, p_tipo: f.tipo,
  })
  if (error) throw error
  return data as Analisis
}

export async function obtenerPrevision(hoy: string, empresa: string | null): Promise<Prevision> {
  const { data, error } = await supabase.rpc('prevision_fondos', { p_hoy: hoy, p_empresa: empresa })
  if (error) throw error
  return data as Prevision
}

export async function ultimoEstimado(tramite: string): Promise<Estimado | null> {
  const { data, error } = await supabase
    .from('estimados')
    .select('id,version,entrada,lineas,total:total_cents::text,confianza,created_at')
    .eq('tramite_id', tramite)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as unknown as Estimado) ?? null
}

export interface DatosEstimar {
  tramite: string
  valor: string | null
  prenda: string | null
  vehiculo: 'auto' | 'moto'
  destino: 'cliente' | 'habitualista_08' | 'reventa_90'
  provincia: string | null
}

export async function estimarTramite(d: DatosEstimar): Promise<string> {
  const { data, error } = await supabase.rpc('estimar_tramite', {
    p_tramite: d.tramite, p_valor: d.valor, p_prenda: d.prenda, p_vehiculo: d.vehiculo, p_destino: d.destino, p_provincia: d.provincia,
  })
  if (error) throw error
  return data as string
}

export async function listarParametros(): Promise<Parametro[]> {
  const { data, error } = await supabase
    .from('parametros_estimador')
    .select('id,clave,vehiculo,provincia,valor:valor::text,vigencia_desde,vigencia_hasta,fuente,verificado')
    .order('clave')
    .order('vigencia_desde', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Parametro[]
}

export interface DatosParametro {
  clave: string
  vehiculo: string | null
  provincia: string | null
  valor: string | null
  vigencia_desde: string
  fuente: string
  verificado: boolean
}

export async function guardarParametro(d: DatosParametro): Promise<void> {
  const { error } = await supabase.rpc('guardar_parametro_estimador', {
    p_clave: d.clave, p_vehiculo: d.vehiculo, p_provincia: d.provincia, p_valor: d.valor,
    p_vigencia_desde: d.vigencia_desde, p_fuente: d.fuente, p_verificado: d.verificado,
  })
  if (error) throw error
}

export interface Comparacion { estimado: string | null; real: string | null; diferencia: string | null; diferencia_pct: string | null }

export async function compararEstimado(tramite: string): Promise<Comparacion> {
  const { data, error } = await supabase
    .rpc('comparar_estimado', { p_tramite: tramite })
    .select('estimado:estimado_cents::text,real:real_cents::text,diferencia:diferencia_cents::text,diferencia_pct:diferencia_pct::text')
  if (error) throw error
  const fila = (Array.isArray(data) ? data[0] : data) as unknown as Comparacion | undefined
  return fila ?? { estimado: null, real: null, diferencia: null, diferencia_pct: null }
}
