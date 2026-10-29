// Consultas y RPC del módulo de rendiciones. Los importes viajan siempre como texto (centavos):
// nunca pasan por number.

import { supabase } from '../../lib/supabase'
import type { Candidato } from './vincular'

export type EstadoRendicion = 'borrador' | 'enviada' | 'observada' | 'aprobada'
export type TipoGuardado = 'recibo_dnrpa' | 'retencion_sellos' | 'factura_honorarios' | 'factura_electronica' | 'otro'
export type VinculoFila = 'auto' | 'manual' | 'ambiguo' | 'sin_vincular'

export interface ControlesRendicion {
  importes: {
    filas: { fila_id: string; nombre: string; pago_cents: string; comprobantes_cents: string; diferencia_cents: string; ok: boolean }[]
    total_planilla_cents: string
    debitado_habitualista_cents: string
    diferencia_cents: string
    movimientos_sin_rendir: { movimiento_id: string; fecha: string; importe_cents: string; tramite_id: string | null; tramite_numero: string | null }[]
    ok: boolean
  }
  autorizados: {
    filas_no_autorizadas: { fila_id: string; nombre: string; motivo: 'sin_vincular' | 'ambiguo' | 'no_autorizado' }[]
    ok: boolean
  }
  honorarios: {
    cantidad_tramites: number
    honorario_unitario_cents: string
    esperado_cents: string
    facturado_cents: string
    diferencia_cents: string
    ok: boolean
  }
}

export interface RendicionFila {
  id: string
  empresa_id: string
  empresa: string
  gestora_id: string
  gestora: string
  periodo: string
  estado: EstadoRendicion
  version: number
  honorario: string
  motivo_observacion: string | null
  filas: number
  total: string
  controles: ControlesRendicion | null
}

export interface FilaGuardada {
  id: string
  orden: number
  nombre: string
  dominio: string | null
  pago: string
  honorarios: string
  tramite_id: string | null
  vinculo: VinculoFila
  candidatos: string[]
}

export interface LineaGuardada {
  concepto: string
  importe: string
}

export interface ComprobanteGuardado {
  id: string
  fila_id: string | null
  tipo: TipoGuardado
  archivo_path: string | null
  archivo_sha256: string | null
  pagina: number
  numero: string | null
  emisor: string | null
  emisor_cuit: string | null
  fecha: string | null
  total: string | null
  dominio: string | null
  documento: string | null
  datos_extraidos: { dudosos?: string[]; nombre?: string | null; origen?: string; confianza?: number | null } | null
  revision: 'pendiente' | 'confirmado'
  created_at: string
  lineas: LineaGuardada[]
  /** URL firmada (10 minutos) del archivo original, si se pudo generar. */
  url: string | null
}

export interface RendicionDetalle extends Omit<RendicionFila, 'filas' | 'total' | 'controles'> {
  filas: FilaGuardada[]
  comprobantes: ComprobanteGuardado[]
}

export interface Duplicado {
  comprobante_id: string
  motivo: 'mismo_archivo' | 'mismo_numero'
  otro_id: string
  otra_rendicion: string
}

// ---------------------------------------------------------------------------------------
// Mapeo (puro): todo importe sale como string de dígitos, aunque llegue como number.
// ---------------------------------------------------------------------------------------

export function centavos(x: unknown): string {
  if (typeof x === 'bigint') return x.toString()
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x)) throw new Error(`Importe inseguro recibido como número: ${x}`)
    return String(x)
  }
  const s = String(x ?? '0').trim()
  if (!/^-?\d+$/.test(s)) throw new Error(`Importe inválido: ${s}`)
  return s
}
const centavosONull = (x: unknown) => (x == null || x === '' ? null : centavos(x))

type Crudo = Record<string, unknown>

export function mapearControles(c: Crudo): ControlesRendicion {
  const imp = c.importes as Crudo
  const aut = c.autorizados as Crudo
  const hon = c.honorarios as Crudo
  return {
    importes: {
      filas: ((imp.filas ?? []) as Crudo[]).map((f) => ({
        fila_id: String(f.fila_id), nombre: String(f.nombre), pago_cents: centavos(f.pago_cents),
        comprobantes_cents: centavos(f.comprobantes_cents), diferencia_cents: centavos(f.diferencia_cents), ok: !!f.ok,
      })),
      total_planilla_cents: centavos(imp.total_planilla_cents),
      debitado_habitualista_cents: centavos(imp.debitado_habitualista_cents),
      diferencia_cents: centavos(imp.diferencia_cents),
      movimientos_sin_rendir: ((imp.movimientos_sin_rendir ?? []) as Crudo[]).map((m) => ({
        movimiento_id: String(m.movimiento_id), fecha: String(m.fecha), importe_cents: centavos(m.importe_cents),
        tramite_id: (m.tramite_id as string) ?? null, tramite_numero: (m.tramite_numero as string) ?? null,
      })),
      ok: !!imp.ok,
    },
    autorizados: {
      filas_no_autorizadas: ((aut.filas_no_autorizadas ?? []) as Crudo[]).map((f) => ({
        fila_id: String(f.fila_id), nombre: String(f.nombre), motivo: f.motivo as 'sin_vincular' | 'ambiguo' | 'no_autorizado',
      })),
      ok: !!aut.ok,
    },
    honorarios: {
      cantidad_tramites: Number(hon.cantidad_tramites ?? 0),
      honorario_unitario_cents: centavos(hon.honorario_unitario_cents),
      esperado_cents: centavos(hon.esperado_cents),
      facturado_cents: centavos(hon.facturado_cents),
      diferencia_cents: centavos(hon.diferencia_cents),
      ok: !!hon.ok,
    },
  }
}

export function mapearFila(f: Crudo): FilaGuardada {
  return {
    id: String(f.id), orden: Number(f.orden), nombre: String(f.nombre), dominio: (f.dominio as string) ?? null,
    pago: centavos(f.pago), honorarios: centavos(f.honorarios), tramite_id: (f.tramite_id as string) ?? null,
    vinculo: (f.vinculo as VinculoFila) ?? 'sin_vincular', candidatos: ((f.candidatos ?? []) as string[]).map(String),
  }
}

export function mapearComprobante(c: Crudo, lineas: Crudo[] = [], url: string | null = null): ComprobanteGuardado {
  return {
    id: String(c.id), fila_id: (c.fila_id as string) ?? null, tipo: c.tipo as TipoGuardado,
    archivo_path: (c.archivo_path as string) ?? null, archivo_sha256: (c.archivo_sha256 as string) ?? null,
    pagina: Number(c.pagina ?? 1), numero: (c.numero as string) ?? null, emisor: (c.emisor as string) ?? null,
    emisor_cuit: (c.emisor_cuit as string) ?? null, fecha: (c.fecha as string) ?? null, total: centavosONull(c.total),
    dominio: (c.dominio as string) ?? null, documento: (c.documento as string) ?? null,
    datos_extraidos: (c.datos_extraidos as ComprobanteGuardado['datos_extraidos']) ?? null,
    revision: (c.revision as 'pendiente' | 'confirmado') ?? 'pendiente', created_at: String(c.created_at ?? ''),
    lineas: lineas.map((l) => ({ concepto: String(l.concepto), importe: centavos(l.importe) })), url,
  }
}

// ---------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------

const SELECT_RENDICION =
  'id,empresa_id,gestora_id,periodo,estado,version,honorario:honorario_unitario_cents::text,motivo_observacion,created_at'
const SELECT_FILA =
  'id,rendicion_id,orden,nombre,dominio,pago:pago_cents::text,honorarios:honorarios_cents::text,tramite_id,vinculo,candidatos'
const SELECT_COMPROBANTE =
  'id,rendicion_id,fila_id,tipo,archivo_path,archivo_sha256,pagina,numero,emisor,emisor_cuit,fecha,total:total_cents::text,' +
  'dominio,documento,datos_extraidos,revision,created_at'

async function nombres(): Promise<{ empresas: Map<string, string>; perfiles: Map<string, string> }> {
  const [e, p] = await Promise.all([
    supabase.from('empresas').select('id,nombre'),
    supabase.from('perfiles').select('id,nombre'),
  ])
  if (e.error) throw e.error
  if (p.error) throw p.error
  return {
    empresas: new Map((e.data ?? []).map((x) => [x.id as string, x.nombre as string])),
    perfiles: new Map((p.data ?? []).map((x) => [x.id as string, x.nombre as string])),
  }
}

export async function controles(id: string): Promise<ControlesRendicion> {
  const { data, error } = await supabase.rpc('controles_rendicion', { p_rendicion: id })
  if (error) throw error
  return mapearControles(data as Crudo)
}

export async function listarRendiciones(f: { empresa?: string; periodo?: string } = {}): Promise<RendicionFila[]> {
  let q = supabase.from('rendiciones').select(SELECT_RENDICION)
  if (f.empresa) q = q.eq('empresa_id', f.empresa)
  if (f.periodo) q = q.eq('periodo', `${f.periodo.slice(0, 7)}-01`)
  const [{ data, error }, n] = await Promise.all([q.order('periodo', { ascending: false }).limit(200), nombres()])
  if (error) throw error
  const rs = (data ?? []) as unknown as Crudo[]
  const ids = rs.map((r) => String(r.id))
  const filas = new Map<string, { n: number; total: bigint }>()
  if (ids.length) {
    const fs = await supabase.from('rendicion_filas').select('rendicion_id,pago:pago_cents::text').in('rendicion_id', ids)
    if (fs.error) throw fs.error
    for (const x of (fs.data ?? []) as unknown as Crudo[]) {
      const k = String(x.rendicion_id)
      const a = filas.get(k) ?? { n: 0, total: 0n }
      filas.set(k, { n: a.n + 1, total: a.total + BigInt(centavos(x.pago)) })
    }
  }
  const ctrls = await Promise.all(ids.map((id) => controles(id).catch(() => null)))
  return rs.map((r, i) => ({
    id: String(r.id), empresa_id: String(r.empresa_id), empresa: n.empresas.get(String(r.empresa_id)) ?? '—',
    gestora_id: String(r.gestora_id), gestora: n.perfiles.get(String(r.gestora_id)) ?? '—',
    periodo: String(r.periodo), estado: r.estado as EstadoRendicion, version: Number(r.version),
    honorario: centavos(r.honorario), motivo_observacion: (r.motivo_observacion as string) ?? null,
    filas: filas.get(String(r.id))?.n ?? 0, total: String(filas.get(String(r.id))?.total ?? 0n), controles: ctrls[i],
  }))
}

export async function obtenerRendicion(id: string): Promise<RendicionDetalle> {
  const [r, fs, cs, n] = await Promise.all([
    supabase.from('rendiciones').select(SELECT_RENDICION).eq('id', id).single(),
    supabase.from('rendicion_filas').select(SELECT_FILA).eq('rendicion_id', id).order('orden'),
    supabase.from('comprobantes').select(SELECT_COMPROBANTE).eq('rendicion_id', id).order('created_at'),
    nombres(),
  ])
  if (r.error) throw r.error
  if (fs.error) throw fs.error
  if (cs.error) throw cs.error
  const crudo = r.data as unknown as Crudo
  const comps = (cs.data ?? []) as unknown as Crudo[]
  const ids = comps.map((c) => String(c.id))
  const lineas = new Map<string, Crudo[]>()
  if (ids.length) {
    const ls = await supabase.from('comprobante_lineas').select('id,comprobante_id,concepto,importe:importe_cents::text').in('comprobante_id', ids)
    if (ls.error) throw ls.error
    for (const l of (ls.data ?? []) as unknown as Crudo[]) {
      const k = String(l.comprobante_id)
      lineas.set(k, [...(lineas.get(k) ?? []), l])
    }
  }
  const paths = [...new Set(comps.map((c) => c.archivo_path as string | null).filter((p): p is string => !!p))]
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase.storage.from('comprobantes').createSignedUrls(paths, 600)
    for (const u of data ?? []) if (u.path && u.signedUrl) urls.set(u.path, u.signedUrl)
  }
  return {
    id: String(crudo.id), empresa_id: String(crudo.empresa_id), empresa: n.empresas.get(String(crudo.empresa_id)) ?? '—',
    gestora_id: String(crudo.gestora_id), gestora: n.perfiles.get(String(crudo.gestora_id)) ?? '—',
    periodo: String(crudo.periodo), estado: crudo.estado as EstadoRendicion, version: Number(crudo.version),
    honorario: centavos(crudo.honorario), motivo_observacion: (crudo.motivo_observacion as string) ?? null,
    filas: ((fs.data ?? []) as unknown as Crudo[]).map(mapearFila),
    comprobantes: comps.map((c) =>
      mapearComprobante(c, lineas.get(String(c.id)), c.archivo_path ? urls.get(String(c.archivo_path)) ?? null : null)),
  }
}

/** Trámites de la razón social que pueden corresponder a una fila de la planilla. */
export async function candidatosDe(empresa: string): Promise<Candidato[]> {
  const { data, error } = await supabase
    .from('tramites')
    .select('id,numero,dominio,estado,autorizado_at,operacion:operaciones(cliente_nombre)')
    .eq('empresa_id', empresa)
    .limit(1000)
  if (error) throw error
  return ((data ?? []) as unknown as Crudo[]).map((t) => ({
    id: String(t.id), numero: String(t.numero), dominio: (t.dominio as string) ?? null,
    cliente: String((t.operacion as Crudo | null)?.cliente_nombre ?? ''),
    autorizado: t.autorizado_at != null && !['cancelado', 'rechazado'].includes(String(t.estado)),
  }))
}

export async function gestorasActivas(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.from('perfiles').select('id,nombre,rol,activo').eq('rol', 'gestora').eq('activo', true).order('nombre')
  if (error) throw error
  return (data ?? []).map((p) => ({ id: p.id as string, nombre: p.nombre as string }))
}

export async function duplicados(id: string): Promise<Duplicado[]> {
  const { data, error } = await supabase.rpc('comprobantes_duplicados', { p_rendicion: id })
  if (error) throw error
  return (data ?? []) as Duplicado[]
}

// ---------------------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------------------

export async function crearRendicion(a: { empresa: string; periodo: string; honorario: string; gestora?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('crear_rendicion', {
    p_empresa: a.empresa, p_periodo: `${a.periodo.slice(0, 7)}-01`, p_honorario: a.honorario, p_gestora: a.gestora ?? null,
  })
  if (error) throw error
  return data as string
}

export interface FilaParaGuardar {
  id?: string
  nombre: string
  dominio: string | null
  pago_cents: string
  honorarios_cents: string
  tramite_id: string | null
  vinculo: VinculoFila
  candidatos: string[]
}

export async function guardarFilas(rendicion: string, filas: FilaParaGuardar[]): Promise<void> {
  const { error } = await supabase.rpc('guardar_filas', { p_rendicion: rendicion, p_filas: filas })
  if (error) throw error
}

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp',
}
export function extensionDe(f: File): string {
  const deNombre = /\.([a-z0-9]{2,5})$/i.exec(f.name)?.[1]?.toLowerCase()
  return EXTENSION[f.type] ?? deNombre ?? 'bin'
}

/** Sube el original al bucket privado. Si el mismo archivo ya estaba, reutiliza la ruta. */
export async function subirComprobante(rendicion: string, f: File, hash: string): Promise<string> {
  const path = `${rendicion}/${hash}.${extensionDe(f)}`
  const { error } = await supabase.storage.from('comprobantes').upload(path, f, { upsert: false, contentType: f.type || undefined })
  if (error) {
    const e = error as { statusCode?: string; message?: string }
    if (String(e.statusCode) === '409' || /exist|duplicate/i.test(e.message ?? '')) return path
    throw error
  }
  return path
}

export interface ComprobanteParaGuardar {
  id?: string
  fila_id: string | null
  tipo: TipoGuardado
  archivo_path?: string | null
  archivo_sha256?: string | null
  pagina?: number
  numero: string | null
  emisor: string | null
  emisor_cuit: string | null
  fecha: string | null
  total_cents: string | null
  dominio: string | null
  documento: string | null
  datos_extraidos?: Record<string, unknown>
  revision: 'pendiente' | 'confirmado'
  lineas: { concepto: string; importe_cents: string }[]
}

export async function guardarComprobante(rendicion: string, datos: ComprobanteParaGuardar): Promise<string> {
  const { data, error } = await supabase.rpc('guardar_comprobante', { p_rendicion: rendicion, p_datos: datos })
  if (error) throw error
  return data as string
}

export async function cambiarEstadoRendicion(a: { id: string; estado: EstadoRendicion; motivo?: string | null; version: number }): Promise<void> {
  const { error } = await supabase.rpc('cambiar_estado_rendicion', {
    p_rendicion: a.id, p_estado: a.estado, p_motivo: a.motivo ?? null, p_version: a.version,
  })
  if (error) throw error
}
