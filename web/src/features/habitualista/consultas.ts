import { supabase } from '../../lib/supabase'

// Saldos e importes vienen de las vistas como texto (cast ::text): el frontend solo los formatea.
export interface Saldo {
  cuenta_id: string
  empresa_id: string
  empresa: string
  registrado: string
  comprometido: string
  disponible: string
  ultima_conciliacion_fecha: string | null
  ultima_diferencia: string | null
}

export interface Movimiento {
  movimiento_id: string
  fecha_operacion: string
  tipo: string
  tramite_numero: string | null
  cliente: string | null
  responsable: string
  ingreso: string
  egreso: string
  saldo: string
  conciliado: boolean
  /** Movimiento que esta reversión revierte. */
  revierte: Movimiento | null
  /** Reversión que anuló este movimiento. */
  revertidoPor: Movimiento | null
}

export interface Compromiso {
  tramite_id: string
  numero: string
  cliente: string
  estado: string
  presupuesto: string | null
  pagado: string
  comprometido: string
  situacion: string
}

export const TIPOS_MOVIMIENTO: Record<string, string> = {
  carga: 'Carga',
  pago_tramite: 'Pago',
  ajuste: 'Ajuste',
  reintegro: 'Reintegro',
  reversion: 'Reversión',
}

export async function listarSaldos(): Promise<Saldo[]> {
  const { data, error } = await supabase
    .from('v_saldos')
    .select(
      'cuenta_id,empresa_id,empresa,registrado:registrado_cents::text,comprometido:comprometido_cents::text,' +
        'disponible:disponible_cents::text,ultima_conciliacion_fecha,ultima_diferencia:ultima_diferencia_cents::text',
    )
    .order('empresa')
  if (error) throw error
  return (data ?? []) as unknown as Saldo[]
}

type FilaExtracto = Omit<Movimiento, 'revierte' | 'revertidoPor'>
type Vinculado = Pick<Movimiento, 'movimiento_id' | 'tipo' | 'fecha_operacion'>
type FilaMov = { id: string; revierte_id: string | null; created_at: string; fecha_operacion: string; tipo: string }

/** Movimientos por página del extracto. */
export const POR_PAGINA = 25

const COLUMNAS_EXTRACTO =
  'movimiento_id,fecha_operacion,tipo,tramite_numero,cliente,responsable,ingreso:ingreso_cents::text,' +
  'egreso:egreso_cents::text,saldo:saldo_resultante_cents::text,conciliado'
const COLUMNAS_MOV = 'id,revierte_id,created_at,fecha_operacion,tipo'
const vinculado = (m: FilaMov): Movimiento =>
  ({ movimiento_id: m.id, tipo: m.tipo, fecha_operacion: m.fecha_operacion } satisfies Vinculado) as Movimiento

export interface PaginaExtracto {
  filas: Movimiento[]
  hayMas: boolean
}

/**
 * Una página del extracto, más reciente primero, con las reversiones ligadas a su original
 * aunque la contraparte esté en otra página. Se pagina con .range() sobre movimientos, en el
 * mismo orden que el saldo acumulado de la vista (fecha_operacion, created_at, id) invertido.
 */
export async function listarExtracto(cuenta: string, pagina = 0): Promise<PaginaExtracto> {
  const desde = pagina * POR_PAGINA
  const movs = await supabase
    .from('movimientos')
    .select(COLUMNAS_MOV)
    .eq('cuenta_id', cuenta)
    .order('fecha_operacion', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(desde, desde + POR_PAGINA) // una fila de más para saber si hay otra página
  if (movs.error) throw movs.error
  const todos = (movs.data ?? []) as unknown as FilaMov[]
  const pag = todos.slice(0, POR_PAGINA)
  if (!pag.length) return { filas: [], hayMas: false }
  const ids = pag.map((m) => m.id)
  const revertidos = [...new Set(pag.map((m) => m.revierte_id).filter((x): x is string => !!x))]
  const [ext, reversiones, originales] = await Promise.all([
    supabase.from('v_movimientos_extracto').select(COLUMNAS_EXTRACTO).eq('cuenta_id', cuenta).in('movimiento_id', ids),
    supabase.from('movimientos').select(COLUMNAS_MOV).in('revierte_id', ids),
    revertidos.length
      ? supabase.from('movimientos').select(COLUMNAS_MOV).in('id', revertidos)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [ext, reversiones, originales]) if (r.error) throw r.error
  const porId = new Map(
    ((ext.data ?? []) as unknown as FilaExtracto[]).map((f) => [f.movimiento_id, { ...f, revierte: null, revertidoPor: null } as Movimiento]),
  )
  const orig = new Map(((originales.data ?? []) as unknown as FilaMov[]).map((m) => [m.id, m]))
  for (const m of pag) {
    const fila = porId.get(m.id)
    const o = m.revierte_id ? orig.get(m.revierte_id) : undefined
    if (fila && o) fila.revierte = vinculado(o)
  }
  for (const r of (reversiones.data ?? []) as unknown as FilaMov[]) {
    const fila = r.revierte_id ? porId.get(r.revierte_id) : undefined
    if (fila) fila.revertidoPor = vinculado(r)
  }
  return { filas: ids.map((id) => porId.get(id)).filter((m): m is Movimiento => !!m), hayMas: todos.length > POR_PAGINA }
}

/** Extracto completo de la cuenta (todas las páginas), más reciente primero, para exportar. */
export async function listarExtractoCompleto(cuenta: string): Promise<Movimiento[]> {
  const filas: FilaExtracto[] = []
  const LOTE = 1000
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await supabase
      .from('v_movimientos_extracto')
      .select(COLUMNAS_EXTRACTO)
      .eq('cuenta_id', cuenta)
      .order('fecha_operacion', { ascending: false })
      .order('created_at', { ascending: false })
      .order('movimiento_id', { ascending: false })
      .range(desde, desde + LOTE - 1)
    if (error) throw error
    const lote = (data ?? []) as unknown as FilaExtracto[]
    filas.push(...lote)
    if (lote.length < LOTE) break
  }
  return filas.map((f) => ({ ...f, revierte: null, revertidoPor: null }))
}

/** Movimientos sin conciliar de la cuenta (todas las páginas), para el formulario de conciliación. */
export async function listarPendientes(cuenta: string): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('v_movimientos_extracto')
    .select(COLUMNAS_EXTRACTO)
    .eq('cuenta_id', cuenta)
    .eq('conciliado', false)
    .order('fecha_operacion', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as FilaExtracto[]).map((f) => ({ ...f, revierte: null, revertidoPor: null }))
}

/** Trámites de la razón social que componen el comprometido. */
export async function listarCompromisos(empresa: string): Promise<Compromiso[]> {
  const fin = await supabase
    .from('v_tramite_finanzas')
    .select(
      'tramite_id,presupuesto:presupuesto_cents::text,pagado:pagado_cents::text,' +
        'comprometido:comprometido_cents::text,situacion',
    )
    .eq('empresa_id', empresa)
    .gt('comprometido_cents', 0)
  if (fin.error) throw fin.error
  const finanzas = (fin.data ?? []) as unknown as Omit<Compromiso, 'numero' | 'cliente' | 'estado'>[]
  if (!finanzas.length) return []
  const tr = await supabase
    .from('tramites')
    .select('id,numero,estado,operacion:operaciones(cliente_nombre)')
    .in('id', finanzas.map((f) => f.tramite_id))
  if (tr.error) throw tr.error
  const tramites = new Map(
    ((tr.data ?? []) as unknown as { id: string; numero: string; estado: string; operacion: { cliente_nombre: string } }[])
      .map((t) => [t.id, t]),
  )
  return finanzas
    .map((f) => {
      const t = tramites.get(f.tramite_id)
      return { ...f, numero: t?.numero ?? '—', cliente: t?.operacion.cliente_nombre ?? '—', estado: t?.estado ?? '' }
    })
    .sort((a, b) => a.numero.localeCompare(b.numero))
}

// bigint viaja como texto en el JSON: PostgREST lo convierte al tipo del parámetro sin pasar por number.
export async function registrarCarga(idem: string, empresa: string, importe: bigint, fecha: string, nota: string) {
  const { error } = await supabase.rpc('registrar_carga', {
    p_idem: idem, p_empresa: empresa, p_importe: importe.toString(), p_fecha: fecha, p_motivo: nota.trim() || null,
  })
  if (error) throw error
}

export async function registrarAjuste(idem: string, empresa: string, importe: bigint, fecha: string, motivo: string) {
  const { error } = await supabase.rpc('registrar_ajuste', {
    p_idem: idem, p_empresa: empresa, p_importe: importe.toString(), p_fecha: fecha, p_motivo: motivo,
  })
  if (error) throw error
}

export async function revertirMovimiento(idem: string, movimiento: string, motivo: string) {
  const { error } = await supabase.rpc('revertir_movimiento', { p_idem: idem, p_movimiento: movimiento, p_motivo: motivo })
  if (error) throw error
}

export async function registrarConciliacion(
  idem: string, empresa: string, fechaCorte: string, saldoExterno: bigint, nota: string, movimientos: string[],
) {
  const { error } = await supabase.rpc('registrar_conciliacion', {
    p_idem: idem, p_empresa: empresa, p_fecha_corte: fechaCorte, p_saldo_externo: saldoExterno.toString(),
    p_nota: nota.trim() || null, p_movimientos: movimientos,
  })
  if (error) throw error
}

export async function aprobarExcepcionFondos(tramite: string, motivo: string) {
  const { error } = await supabase.rpc('aprobar_excepcion_fondos', { p_tramite: tramite, p_motivo: motivo })
  if (error) throw error
}
