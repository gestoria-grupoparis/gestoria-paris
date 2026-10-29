import { supabase } from '../../lib/supabase'
import {
  DIAS_DEMORA_AUTORIZADO, ESTADOS, hoyEnBuenosAires, inicioDelDia, restarDiasHabiles,
} from '../tramites/filtros'

/**
 * Un conteo exacto por estado (HEAD + Prefer: count=exact): no trae filas, así que no lo
 * trunca el tope max_rows de PostgREST.
 */
export async function contarPorEstado(): Promise<Record<string, number>> {
  const resultados = await Promise.all(
    ESTADOS.map((e) =>
      supabase.from('tramites').select('id', { count: 'exact', head: true }).eq('estado', e.id),
    ),
  )
  const cuenta: Record<string, number> = {}
  ESTADOS.forEach((e, i) => {
    const { count, error } = resultados[i]
    if (error) throw error
    if (count == null) throw new Error(`Sin conteo para el estado ${e.id}`)
    cuenta[e.id] = count
  })
  return cuenta
}

export type Motivo = 'observado' | 'por_aprobar' | 'sin_fondos' | 'demorado'
export interface Intervencion {
  id: string
  numero: string
  cliente: string
  empresa: string
  motivos: Motivo[]
}

/** Corte de "demorado": autorizados hace más de N días hábiles (la base no conoce feriados). */
const corteDemora = () => inicioDelDia(restarDiasHabiles(hoyEnBuenosAires(), DIAS_DEMORA_AUTORIZADO))

/** Observados, por aprobar, sin fondos y demorados, resuelto en la base en una sola llamada. */
export async function listarIntervencion(): Promise<Intervencion[]> {
  const { data, error } = await supabase.rpc('tramites_intervencion', { p_corte: corteDemora() })
  if (error) throw error
  return (data ?? []) as Intervencion[]
}

export interface ResumenEmpresa {
  empresa_id: string
  empresa: string
  abiertos: number
  por_aprobar: number
  listos: number
  presentados: number
  finalizados: number
  devueltos: number
  sin_fondos: number
  demorados: number
}

/** Conteos por razón social y etapa del ping pong con la gestoría (respeta el alcance). */
export async function resumenTablero(): Promise<ResumenEmpresa[]> {
  const { data, error } = await supabase.rpc('resumen_tablero', { p_corte: corteDemora() })
  if (error) throw error
  return (data ?? []) as ResumenEmpresa[]
}

export function sumar(filas: ResumenEmpresa[], campo: Exclude<keyof ResumenEmpresa, 'empresa_id' | 'empresa'>): number {
  return filas.reduce((n, f) => n + Number(f[campo] ?? 0), 0)
}
