import { supabase } from '../../lib/supabase'
import {
  DIAS_DEMORA_AUTORIZADO, DIAS_DEMORA_PRESENTADO, hoyEnBuenosAires, inicioDelDia, limpiarBusqueda,
  restarDiasHabiles, type FiltrosTramites,
} from './filtros'

export type { FiltrosTramites } from './filtros'

// Los importes llegan como texto (cast ::text en PostgREST) para no pasar nunca por number.
export interface Finanzas {
  presupuesto: string | null
  pagado: string | null
  situacion: string
  /** Versión vigente del presupuesto y si la empresa ya la aprobó (circuito con la gestora). */
  presupuesto_version: number | null
  presupuesto_aprobado: boolean
}

export interface TramiteFila {
  id: string
  numero: string
  created_at: string
  estado: string
  vehiculo_desc: string
  dominio: string | null
  chasis: string | null
  version: number
  autorizado_at: string | null
  gestora_id: string | null
  empresa_id: string
  sucursal_id: string
  tipo: { codigo: string; nombre: string }
  operacion: {
    cliente_nombre: string
    cuenta_personal: string
    oferta_ref: string
    empresa: { nombre: string }
    sucursal: { nombre: string; provincia: string }
  }
  finanzas: Finanzas | null
}

export interface Marca {
  marca: string
  at: string
  por: string
}
export interface PresupuestoVersion {
  version: number
  total: string
  motivo: string | null
  created_at: string
}
export interface Pago {
  id: string
  tipo: string
  importe: string
  fecha_operacion: string
  es_pago_final: boolean
}
export interface TramiteDetalle extends TramiteFila {
  marcas: Marca[]
  presupuestos: PresupuestoVersion[]
  pagos: Pago[]
}

export interface Evento {
  id: number
  at: string
  actor_id: string | null
  entidad: string
  accion: string
  estado_antes: string | null
  estado_despues: string | null
  gestora_antes: string | null
  gestora_despues: string | null
  marca: string | null
  motivo: string | null
}

const SELECT_TRAMITE =
  'id,numero,created_at,estado,vehiculo_desc,dominio,chasis,version,autorizado_at,gestora_id,empresa_id,sucursal_id,' +
  'tipo:tipos_tramite(codigo,nombre),' +
  'operacion:operaciones(cliente_nombre,cuenta_personal,oferta_ref,empresa:empresas(nombre),sucursal:sucursales(nombre,provincia))'

const SELECT_FINANZAS =
  'tramite_id,presupuesto:presupuesto_cents::text,pagado:pagado_cents::text,situacion,presupuesto_version,presupuesto_aprobado'

export const LIMITE = 500

function sinResultados<T>(): T[] {
  return []
}

async function finanzasDe(ids: string[]): Promise<Map<string, Finanzas>> {
  const mapa = new Map<string, Finanzas>()
  if (ids.length === 0) return mapa
  const { data, error } = await supabase.from('v_tramite_finanzas').select(SELECT_FINANZAS).in('tramite_id', ids)
  if (error) throw error
  for (const f of (data ?? []) as unknown as (Finanzas & { tramite_id: string })[]) {
    mapa.set(f.tramite_id, {
      presupuesto: f.presupuesto, pagado: f.pagado, situacion: f.situacion,
      presupuesto_version: f.presupuesto_version ?? null, presupuesto_aprobado: !!f.presupuesto_aprobado,
    })
  }
  return mapa
}

export async function listarTramites(f: FiltrosTramites, sucursalesDeProvincia?: string[]): Promise<TramiteFila[]> {
  let consulta = supabase.from('tramites').select(SELECT_TRAMITE)

  const q = limpiarBusqueda(f.q)
  if (q) {
    // Búsqueda única: cliente, cuenta y oferta viven en operaciones; dominio (y chasis) en trámites.
    const ops = await supabase
      .from('operaciones')
      .select('id')
      .or(`cliente_nombre.ilike.*${q}*,cuenta_personal.ilike.*${q}*,oferta_ref.ilike.*${q}*`)
      .limit(LIMITE)
    if (ops.error) throw ops.error
    const ids = (ops.data ?? []).map((o) => o.id as string)
    const condiciones = [`dominio.ilike.*${q}*`, `chasis.ilike.*${q}*`, `numero.ilike.*${q}*`]
    if (ids.length) condiciones.push(`operacion_id.in.(${ids.join(',')})`)
    consulta = consulta.or(condiciones.join(','))
  }

  if (f.empresa) consulta = consulta.eq('empresa_id', f.empresa)
  if (f.sucursal) consulta = consulta.eq('sucursal_id', f.sucursal)
  if (f.provincia) {
    if (!sucursalesDeProvincia?.length) return sinResultados()
    consulta = consulta.in('sucursal_id', sucursalesDeProvincia)
  }
  if (f.gestora) consulta = consulta.eq('gestora_id', f.gestora)
  if (f.tipo) consulta = consulta.eq('tipo_id', f.tipo)
  if (f.estado) consulta = consulta.eq('estado', f.estado)
  if (f.desde) consulta = consulta.gte('created_at', inicioDelDia(f.desde))
  if (f.hasta) {
    const siguiente = new Date(`${f.hasta}T00:00:00Z`)
    siguiente.setUTCDate(siguiente.getUTCDate() + 1)
    consulta = consulta.lt('created_at', inicioDelDia(siguiente.toISOString().slice(0, 10)))
  }

  switch (f.vista) {
    case 'para_revisar':
      consulta = consulta.eq('estado', 'borrador')
      break
    case 'autorizados_sin_presentar':
      consulta = consulta.in('estado', ['autorizado', 'en_gestoria'])
      break
    case 'para_aprobar': {
      // Presupuesto cargado por la gestora que la empresa todavía no aprobó.
      const pa = await supabase
        .from('v_tramite_finanzas')
        .select('tramite_id')
        .eq('presupuesto_aprobado', false)
        .not('presupuesto_version', 'is', null)
      if (pa.error) throw pa.error
      const ids = (pa.data ?? []).map((x) => x.tramite_id as string)
      if (!ids.length) return sinResultados()
      consulta = consulta.in('id', ids).in('estado', ['autorizado', 'en_gestoria'])
      break
    }
    case 'sin_fondos': {
      const sf = await supabase.from('v_tramite_finanzas').select('tramite_id').eq('situacion', 'sin_fondos')
      if (sf.error) throw sf.error
      const ids = (sf.data ?? []).map((x) => x.tramite_id as string)
      if (!ids.length) return sinResultados()
      consulta = consulta.in('id', ids)
      break
    }
    case 'demorados': {
      // Aproximación: el instante de presentación no está en trámites; se mide desde la autorización.
      const hoy = hoyEnBuenosAires()
      const corteAutorizado = inicioDelDia(restarDiasHabiles(hoy, DIAS_DEMORA_AUTORIZADO))
      const cortePresentado = inicioDelDia(restarDiasHabiles(hoy, DIAS_DEMORA_PRESENTADO))
      consulta = consulta.or(
        `and(estado.in.(autorizado,en_gestoria),autorizado_at.lt.${corteAutorizado}),` +
          `and(estado.eq.presentado,autorizado_at.lt.${cortePresentado})`,
      )
      break
    }
  }

  const { data, error } = await consulta.order('created_at', { ascending: false }).limit(LIMITE)
  if (error) throw error
  const filas = (data ?? []) as unknown as Omit<TramiteFila, 'finanzas'>[]
  const fin = await finanzasDe(filas.map((t) => t.id))
  return filas.map((t) => ({ ...t, finanzas: fin.get(t.id) ?? null }))
}

export async function obtenerTramite(id: string): Promise<TramiteDetalle | null> {
  const { data, error } = await supabase
    .from('tramites')
    .select(
      `${SELECT_TRAMITE},marcas:tramite_marcas(marca,at,por),` +
        'presupuestos(version,total:total_cents::text,motivo,created_at)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const t = data as unknown as Omit<TramiteDetalle, 'finanzas' | 'pagos'>
  const [fin, pagos] = await Promise.all([
    finanzasDe([id]),
    supabase
      .from('movimientos')
      .select('id,tipo,importe:importe_cents::text,fecha_operacion,es_pago_final')
      .eq('tramite_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (pagos.error) throw pagos.error
  return {
    ...t,
    presupuestos: [...(t.presupuestos ?? [])].sort((a, b) => b.version - a.version),
    finanzas: fin.get(id) ?? null,
    pagos: (pagos.data ?? []) as unknown as Pago[],
  }
}

export async function historial(id: string): Promise<Evento[]> {
  const { data, error } = await supabase
    .from('eventos')
    .select(
      'id,at,actor_id,entidad,accion,motivo,estado_antes:antes->>estado,estado_despues:despues->>estado,' +
        'gestora_antes:antes->>gestora_id,gestora_despues:despues->>gestora_id,marca:despues->>marca',
    )
    .in('entidad', ['tramites', 'tramite_marcas'])
    .eq('entidad_id', id)
    .order('at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Evento[]
}

// --- Catálogos -------------------------------------------------------------------------------
export interface Catalogos {
  empresas: { id: string; nombre: string }[]
  sucursales: { id: string; nombre: string; provincia: string }[]
  tipos: { id: string; codigo: string; nombre: string }[]
  perfiles: { id: string; nombre: string; rol: string; activo: boolean }[]
}

export async function cargarCatalogos(): Promise<Catalogos> {
  const [e, s, t, p] = await Promise.all([
    supabase.from('empresas').select('id,nombre').order('nombre'),
    supabase.from('sucursales').select('id,nombre,provincia').order('nombre'),
    supabase.from('tipos_tramite').select('id,codigo,nombre').eq('activo', true).order('nombre'),
    supabase.from('perfiles').select('id,nombre,rol,activo').order('nombre'),
  ])
  for (const r of [e, s, t, p]) if (r.error) throw r.error
  return {
    empresas: e.data ?? [],
    sucursales: s.data ?? [],
    tipos: t.data ?? [],
    perfiles: p.data ?? [],
  }
}

// --- RPC ---------------------------------------------------------------------------------------
export interface AltaTramite {
  idem: string
  empresa: string
  sucursal: string
  tipo: string
  cliente: string
  cuentaPersonal: string
  oferta: string
  vehiculo: string
  dominio: string
  chasis: string
}

export async function buscarDuplicados(empresa: string, oferta: string, dominio: string) {
  const { data, error } = await supabase.rpc('buscar_duplicados', {
    p_empresa: empresa, p_oferta: oferta, p_dominio: dominio || null,
  })
  if (error) throw error
  return (data ?? []) as { id: string; numero: string; estado: string }[]
}

export async function crearTramite(a: AltaTramite): Promise<string> {
  const { data, error } = await supabase.rpc('crear_tramite', {
    p_idem: a.idem, p_empresa: a.empresa, p_sucursal: a.sucursal, p_tipo: a.tipo, p_cliente: a.cliente,
    p_cuenta_personal: a.cuentaPersonal, p_oferta: a.oferta, p_vehiculo: a.vehiculo,
    p_dominio: a.dominio || null, p_chasis: a.chasis || null,
  })
  if (error) throw error
  return data as string
}

async function sinRetorno(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p
  if (error) throw error
}

export const autorizarTramite = (id: string, gestora: string, version: number) =>
  sinRetorno(supabase.rpc('autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: version }))

export const cambiarEstado = (id: string, estado: string, motivo: string, version: number) =>
  sinRetorno(supabase.rpc('cambiar_estado', { p_tramite: id, p_estado: estado, p_motivo: motivo, p_version: version }))

export const marcar = (id: string, marca: string) =>
  sinRetorno(supabase.rpc('marcar', { p_tramite: id, p_marca: marca }))

/** Reasignación en lote (caso K), todo o nada. Devuelve cuántos trámites cambiaron de gestora. */
export async function reasignarGestora(ids: string[], gestora: string, motivo: string): Promise<number> {
  const { data, error } = await supabase.rpc('reasignar_gestora', { p_tramites: ids, p_gestora: gestora, p_motivo: motivo })
  if (error) throw error
  return Number(data ?? 0)
}

export interface EdicionTramite {
  cliente: string
  cuentaPersonal: string
  oferta: string
  vehiculo: string
  dominio: string
  chasis: string
  motivo: string
}

export const editarTramite = (id: string, version: number, d: EdicionTramite) =>
  sinRetorno(supabase.rpc('editar_tramite', {
    p_tramite: id, p_version: version, p_cliente: d.cliente, p_cuenta_personal: d.cuentaPersonal,
    p_oferta: d.oferta, p_vehiculo: d.vehiculo, p_dominio: d.dominio || null, p_chasis: d.chasis || null,
    p_motivo: d.motivo || null,
  }))

/** La empresa aprueba la versión vigente del presupuesto que cargó la gestora (le guarda la plata). */
export const aprobarPresupuesto = (id: string, version: number) =>
  sinRetorno(supabase.rpc('aprobar_presupuesto', { p_tramite: id, p_version: version }))

/** Quita una marca documental puesta por error (con motivo, queda en el historial). */
export const desmarcar = (id: string, marca: string, motivo: string) =>
  sinRetorno(supabase.rpc('desmarcar', { p_tramite: id, p_marca: marca, p_motivo: motivo }))

/** Retira una aprobación de presupuesto hecha por error, antes de presentar. */
export const revocarAprobacion = (id: string, motivo: string) =>
  sinRetorno(supabase.rpc('revocar_aprobacion', { p_tramite: id, p_motivo: motivo }))

export const aprobarExcepcionFondos = (id: string, motivo: string) =>
  sinRetorno(supabase.rpc('aprobar_excepcion_fondos', { p_tramite: id, p_motivo: motivo }))

/** Reintegro de fondos del trámite a su cuenta (caso F). Importe en centavos, viaja como texto. */
export async function registrarReintegro(idem: string, tramite: string, importe: bigint, fecha: string, motivo: string) {
  const { error } = await supabase.rpc('registrar_reintegro', {
    p_idem: idem, p_tramite: tramite, p_importe: importe.toString(), p_fecha: fecha, p_motivo: motivo,
  })
  if (error) throw error
}
