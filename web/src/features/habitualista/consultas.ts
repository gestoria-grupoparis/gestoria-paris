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

/** Extracto de la cuenta, más reciente primero, con las reversiones ligadas a su original. */
export async function listarExtracto(cuenta: string): Promise<Movimiento[]> {
  const [ext, movs] = await Promise.all([
    supabase
      .from('v_movimientos_extracto')
      .select(
        'movimiento_id,fecha_operacion,tipo,tramite_numero,cliente,responsable,ingreso:ingreso_cents::text,' +
          'egreso:egreso_cents::text,saldo:saldo_resultante_cents::text,conciliado',
      )
      .eq('cuenta_id', cuenta),
    supabase.from('movimientos').select('id,revierte_id,created_at').eq('cuenta_id', cuenta),
  ])
  if (ext.error) throw ext.error
  if (movs.error) throw movs.error
  const filas = (ext.data ?? []) as unknown as FilaExtracto[]
  const datos = (movs.data ?? []) as { id: string; revierte_id: string | null; created_at: string }[]
  const creado = new Map(datos.map((m) => [m.id, m.created_at]))
  const porId = new Map(filas.map((f) => [f.movimiento_id, { ...f, revierte: null, revertidoPor: null } as Movimiento]))
  for (const { id, revierte_id } of datos) {
    const reversion = porId.get(id)
    const original = revierte_id ? porId.get(revierte_id) : undefined
    if (reversion && original) {
      reversion.revierte = original
      original.revertidoPor = reversion
    }
  }
  // Mismo orden que el saldo acumulado de la vista (fecha_operacion, created_at, id), invertido.
  const clave = (m: Movimiento) => `${m.fecha_operacion}|${creado.get(m.movimiento_id) ?? ''}|${m.movimiento_id}`
  return [...porId.values()].sort((a, b) => clave(b).localeCompare(clave(a)))
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
