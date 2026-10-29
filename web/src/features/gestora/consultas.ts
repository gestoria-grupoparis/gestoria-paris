import { supabase } from '../../lib/supabase'

// Importes como texto (cast ::text): el frontend no suma ni resta, solo formatea.
export interface TramiteGestora {
  id: string
  numero: string
  estado: string
  version: number
  vehiculo_desc: string
  dominio: string | null
  empresa_id: string
  operacion: {
    cliente_nombre: string
    empresa: { nombre: string }
    sucursal: { nombre: string; provincia: string }
  }
  marcas: { marca: string }[]
  presupuesto: string | null
  presupuesto_version: number | null
  presupuesto_aprobado: boolean
  situacion: string
}

export const ESTADOS_GESTORA = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro']

/** Ping pong con la empresa: cada grupo es lo que la gestora tiene que hacer ahora (o esperar). */
export type Grupo = 'presupuestar' | 'aprobacion' | 'listos' | 'presentados' | 'devolver'

export const GRUPOS: { id: Grupo; titulo: string }[] = [
  { id: 'presupuestar', titulo: 'Presupuestar' },
  { id: 'aprobacion', titulo: 'Esperando aprobación' },
  { id: 'listos', titulo: 'Retirar y presentar' },
  { id: 'presentados', titulo: 'Presentados' },
  { id: 'devolver', titulo: 'Para devolver' },
]

const retirado = (t: Pick<TramiteGestora, 'marcas'>) => t.marcas.some((m) => m.marca === 'retirado')

export function grupoDe(t: Pick<TramiteGestora, 'estado' | 'situacion' | 'marcas' | 'presupuesto_aprobado'>): Grupo | null {
  if (t.estado === 'finalizado_registro') return 'devolver'
  if (t.estado === 'presentado') return t.situacion === 'sin_presupuesto' ? 'presupuestar' : 'presentados'
  if (t.estado === 'autorizado' || t.estado === 'en_gestoria') {
    if (t.situacion === 'sin_presupuesto') return 'presupuestar'
    return t.presupuesto_aprobado ? 'listos' : 'aprobacion'
  }
  return null
}

/** En "Retirar y presentar": primero retira el legajo, después presenta. */
export const legajoRetirado = retirado

export async function listarMisTramites(gestora: string): Promise<TramiteGestora[]> {
  const { data, error } = await supabase
    .from('tramites')
    .select(
      'id,numero,estado,version,vehiculo_desc,dominio,empresa_id,' +
        'operacion:operaciones(cliente_nombre,empresa:empresas(nombre),sucursal:sucursales(nombre,provincia)),' +
        'marcas:tramite_marcas(marca)',
    )
    .eq('gestora_id', gestora)
    .in('estado', ESTADOS_GESTORA)
    .order('created_at', { ascending: true })
  if (error) throw error
  const filas = (data ?? []) as unknown as Omit<TramiteGestora, 'presupuesto' | 'presupuesto_version' | 'presupuesto_aprobado' | 'situacion'>[]
  if (!filas.length) return []
  const fin = await supabase
    .from('v_tramite_finanzas')
    .select('tramite_id,presupuesto:presupuesto_cents::text,situacion,presupuesto_version,presupuesto_aprobado')
    .in('tramite_id', filas.map((t) => t.id))
  if (fin.error) throw fin.error
  type Fin = { tramite_id: string; presupuesto: string | null; situacion: string; presupuesto_version: number | null; presupuesto_aprobado: boolean }
  const mapa = new Map(((fin.data ?? []) as unknown as Fin[]).map((f) => [f.tramite_id, f]))
  return filas.map((t) => {
    const f = mapa.get(t.id)
    return {
      ...t,
      presupuesto: f?.presupuesto ?? null,
      presupuesto_version: f?.presupuesto_version ?? null,
      presupuesto_aprobado: !!f?.presupuesto_aprobado,
      situacion: f?.situacion ?? 'no_aplica',
    }
  })
}

/** Plata de cada razón social con la que trabaja la gestora (importes en centavos, como texto). */
export interface SaldoGestora {
  empresa_id: string
  empresa: string
  disponible: string
  comprometido: string
}

export async function listarSaldosGestora(): Promise<SaldoGestora[]> {
  const { data, error } = await supabase
    .rpc('saldos_gestora')
    .select('empresa_id,empresa,disponible:disponible_cents::text,comprometido:comprometido_cents::text')
  if (error) throw error
  return (data ?? []) as unknown as SaldoGestora[]
}

export interface Conceptos {
  arancel: bigint
  prenda: bigint
  sellado: bigint
  otros: bigint
}

// bigint viaja como texto en el JSON: PostgREST lo convierte al tipo del parámetro sin pasar por number.
const comoTexto = (c: Conceptos) => ({
  p_arancel: c.arancel.toString(), p_prenda: c.prenda.toString(), p_sellado: c.sellado.toString(), p_otros: c.otros.toString(),
})

export async function registrarPresupuesto(tramite: string, c: Conceptos, motivo?: string) {
  const { error } = await supabase.rpc('registrar_presupuesto', { p_tramite: tramite, ...comoTexto(c), p_motivo: motivo || null })
  if (error) throw error
}

export async function registrarPago(idem: string, tramite: string, fecha: string, c: Conceptos, esFinal: boolean, motivo?: string) {
  const { error } = await supabase.rpc('registrar_pago', {
    p_idem: idem, p_tramite: tramite, p_fecha: fecha, ...comoTexto(c), p_es_final: esFinal, p_motivo: motivo || null,
  })
  if (error) throw error
}
