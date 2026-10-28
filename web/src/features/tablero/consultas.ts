import { supabase } from '../../lib/supabase'
import {
  DIAS_DEMORA_AUTORIZADO, ESTADOS, hoyEnBuenosAires, inicioDelDia, restarDiasHabiles,
} from '../tramites/filtros'

export async function contarPorEstado(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('tramites').select('estado')
  if (error) throw error
  const cuenta: Record<string, number> = Object.fromEntries(ESTADOS.map((e) => [e.id, 0]))
  for (const { estado } of (data ?? []) as { estado: string }[]) cuenta[estado] = (cuenta[estado] ?? 0) + 1
  return cuenta
}

export type Motivo = 'observado' | 'sin_fondos' | 'demorado'
export interface Intervencion {
  id: string
  numero: string
  cliente: string
  empresa: string
  motivos: Motivo[]
}

const SELECT = 'id,numero,estado,autorizado_at,operacion:operaciones(cliente_nombre,empresa:empresas(nombre))'
type FilaTramite = {
  id: string
  numero: string
  estado: string
  autorizado_at: string | null
  operacion: { cliente_nombre: string; empresa: { nombre: string } }
}

/** Observados, sin fondos y autorizados con más de 5 días hábiles sin presentar (P8, provisorio). */
export async function listarIntervencion(): Promise<Intervencion[]> {
  const corte = inicioDelDia(restarDiasHabiles(hoyEnBuenosAires(), DIAS_DEMORA_AUTORIZADO))
  const [tr, fin] = await Promise.all([
    supabase
      .from('tramites')
      .select(SELECT)
      .or(`estado.eq.observado,and(estado.in.(autorizado,en_gestoria),autorizado_at.lt.${corte})`),
    supabase.from('v_tramite_finanzas').select('tramite_id').eq('situacion', 'sin_fondos'),
  ])
  if (tr.error) throw tr.error
  if (fin.error) throw fin.error
  const sinFondos = new Set(((fin.data ?? []) as { tramite_id: string }[]).map((f) => f.tramite_id))
  const filas = (tr.data ?? []) as unknown as FilaTramite[]
  const faltan = [...sinFondos].filter((id) => !filas.some((t) => t.id === id))
  if (faltan.length) {
    const extra = await supabase.from('tramites').select(SELECT).in('id', faltan)
    if (extra.error) throw extra.error
    filas.push(...((extra.data ?? []) as unknown as FilaTramite[]))
  }
  return filas
    .map((t) => {
      const motivos: Motivo[] = []
      if (t.estado === 'observado') motivos.push('observado')
      if (sinFondos.has(t.id)) motivos.push('sin_fondos')
      if (['autorizado', 'en_gestoria'].includes(t.estado) && t.autorizado_at && Date.parse(t.autorizado_at) < Date.parse(corte))
        motivos.push('demorado')
      return {
        id: t.id, numero: t.numero, cliente: t.operacion.cliente_nombre, empresa: t.operacion.empresa.nombre, motivos,
      }
    })
    .filter((t) => t.motivos.length)
    .sort((a, b) => a.numero.localeCompare(b.numero))
}
