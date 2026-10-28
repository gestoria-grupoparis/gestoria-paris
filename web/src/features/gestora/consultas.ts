import { supabase } from '../../lib/supabase'

// Importes como texto (cast ::text): el frontend no suma ni resta, solo formatea.
export interface TramiteGestora {
  id: string
  numero: string
  estado: string
  version: number
  vehiculo_desc: string
  dominio: string | null
  operacion: {
    cliente_nombre: string
    empresa: { nombre: string }
    sucursal: { nombre: string; provincia: string }
  }
  marcas: { marca: string }[]
  presupuesto: string | null
  situacion: string
}

export const ESTADOS_GESTORA = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro']

export type Grupo = 'presupuestar' | 'listos' | 'presentados' | 'retirar'

export const GRUPOS: { id: Grupo; titulo: string }[] = [
  { id: 'presupuestar', titulo: 'Presupuestar' },
  { id: 'listos', titulo: 'Listos para presentar' },
  { id: 'presentados', titulo: 'Presentados' },
  { id: 'retirar', titulo: 'Para retirar' },
]

export function grupoDe(t: Pick<TramiteGestora, 'estado' | 'situacion' | 'marcas'>): Grupo | null {
  if (t.estado === 'finalizado_registro') return t.marcas.some((m) => m.marca === 'retirado') ? null : 'retirar'
  if (t.situacion === 'sin_presupuesto') return 'presupuestar'
  if (t.estado === 'autorizado' || t.estado === 'en_gestoria') return 'listos'
  if (t.estado === 'presentado') return 'presentados'
  return null
}

export async function listarMisTramites(gestora: string): Promise<TramiteGestora[]> {
  const { data, error } = await supabase
    .from('tramites')
    .select(
      'id,numero,estado,version,vehiculo_desc,dominio,' +
        'operacion:operaciones(cliente_nombre,empresa:empresas(nombre),sucursal:sucursales(nombre,provincia)),' +
        'marcas:tramite_marcas(marca)',
    )
    .eq('gestora_id', gestora)
    .in('estado', ESTADOS_GESTORA)
    .order('created_at', { ascending: true })
  if (error) throw error
  const filas = (data ?? []) as unknown as Omit<TramiteGestora, 'presupuesto' | 'situacion'>[]
  if (!filas.length) return []
  const fin = await supabase
    .from('v_tramite_finanzas')
    .select('tramite_id,presupuesto:presupuesto_cents::text,situacion')
    .in('tramite_id', filas.map((t) => t.id))
  if (fin.error) throw fin.error
  const mapa = new Map(
    ((fin.data ?? []) as unknown as { tramite_id: string; presupuesto: string | null; situacion: string }[]).map(
      (f) => [f.tramite_id, f],
    ),
  )
  return filas.map((t) => ({
    ...t,
    presupuesto: mapa.get(t.id)?.presupuesto ?? null,
    situacion: mapa.get(t.id)?.situacion ?? 'no_aplica',
  }))
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

export async function registrarPresupuesto(tramite: string, c: Conceptos) {
  const { error } = await supabase.rpc('registrar_presupuesto', { p_tramite: tramite, ...comoTexto(c) })
  if (error) throw error
}

export async function registrarPago(idem: string, tramite: string, fecha: string, c: Conceptos, esFinal: boolean) {
  const { error } = await supabase.rpc('registrar_pago', {
    p_idem: idem, p_tramite: tramite, p_fecha: fecha, ...comoTexto(c), p_es_final: esFinal,
  })
  if (error) throw error
}
