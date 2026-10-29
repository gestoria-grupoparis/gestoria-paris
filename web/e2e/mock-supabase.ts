// Simula la API HTTP de Supabase (auth + PostgREST + RPC + Realtime) para los E2E. No hay usuarios de
// prueba en staging y no se pueden crear, así que el navegador nunca sale de este mock: las RPC
// replican la parte de las reglas de negocio que ejercitan los specs (duplicados, versión, motivo
// obligatorio, saldos y compromisos).
import type { Page, Route } from '@playwright/test'
import sesion from './fixtures/sesion.json' with { type: 'json' }
import catalogos from './fixtures/catalogos.json' with { type: 'json' }

const MAX_ROWS = 1000

export const SUPABASE_URL = 'http://supabase.e2e.test'
const CLAVE_SESION = 'sb-supabase-auth-token'

type Fila = Record<string, unknown>

export interface Estado {
  operaciones: Fila[]
  tramites: Fila[]
  marcas: Fila[]
  eventos: Fila[]
  presupuestos: Fila[]
  /** { tramite_id, version } de cada presupuesto aprobado por la empresa. */
  aprobaciones: Fila[]
  /** importe con signo en centavos (texto), como movimientos.importe_cents. */
  movimientos: Fila[]
  /** { cuenta_id, fecha_corte, diferencia, movimientos: id[] } */
  conciliaciones: Fila[]
  siguienteEvento: number
  /** Rendiciones y lo que cuelga de ellas (importes en centavos, texto, con los alias del front). */
  rendiciones: Fila[]
  rendicionFilas: Fila[]
  comprobantes: Fila[]
  comprobanteLineas: Fila[]
  /** Storage del bucket comprobantes: ruta -> contenido. */
  archivos: Map<string, { cuerpo: Buffer; tipo: string }>
}

export interface Semilla {
  operacion: Fila
  tramite: Fila
  /** Totales en centavos (texto) de las versiones del presupuesto, de la 1 en adelante. */
  presupuestos?: string[]
  /** Fuerza la situación financiera (p. ej. sin_fondos, que depende del saldo de la cuenta). */
  situacion?: string
  /** La empresa ya aprobó la última versión del presupuesto. */
  aprobado?: boolean
  /** Marcas documentales ya registradas (p. ej. 'retirado'). */
  marcas?: string[]
}

export interface Extra {
  movimientos?: Fila[]
  conciliaciones?: Fila[]
  rendiciones?: Fila[]
  rendicionFilas?: Fila[]
  comprobantes?: Fila[]
  comprobanteLineas?: Fila[]
}

interface Canal {
  joinRef: unknown
  bindings: { id: number; table: string }[]
}
interface Socket {
  enviar: (msg: unknown[]) => void
  canales: Map<string, Canal>
}

/** Estado del "servidor". Se comparte entre páginas para probar Realtime con dos navegadores. */
export interface Servidor {
  st: Estado
  situacionForzada: Map<unknown, string>
  sockets: Set<Socket>
  siguienteInstante: () => string
  notificar: (tabla: string) => void
}

export interface OpcionesMock {
  /** Id de perfil (de fixtures/catalogos.json) con el que se inicia la sesión. Por defecto, Carla Contable. */
  usuario?: string
  /** Servidor compartido con otras páginas; si falta, se crea uno con las semillas. */
  servidor?: Servidor
  /**
   * Alcances del perfil (como public.alcances; sucursal_id null = toda la empresa). Si se pasan, el
   * mock aplica tiene_alcance() como la base: crear/autorizar trámites y cargar fondos exigen alcance,
   * trámites y finanzas se filtran por alcance y v_saldos solo muestra empresas con alcance completo.
   * Sin alcances, el perfil ve todo (specs que no prueban permisos).
   */
  alcances?: { empresa_id: string; sucursal_id: string | null }[]
  /** Filas de public.alcances de todos los perfiles (pantalla de Usuarios). */
  tablaAlcances?: { perfil_id: string; empresa_id: string; sucursal_id: string | null }[]
  /** Perfiles adicionales a los de fixtures/catalogos.json (p. ej. un admin). */
  perfilesExtra?: { id: string; nombre: string; rol: string; activo: boolean; debe_cambiar_clave?: boolean; email?: string }[]
  /**
   * Fuente fija de v_saldos (salida real de la base, p. ej. fixtures/escenario-saldos.json). Recibe el
   * estado y devuelve las filas, o undefined si el estado no tiene salida registrada: en ese caso la
   * consulta responde 500 y el test falla en lugar de mostrar un saldo calculado por el mock.
   */
  saldosFijos?: (st: Estado) => Fila[] | undefined
  /** Arranca sin sesión guardada (pantalla de ingreso, link de recuperación vencido). */
  sinSesion?: boolean
  /** Filas de public.notificaciones (de cualquier perfil: el mock aplica la RLS perfil_id = yo). */
  notificaciones?: { id: string; perfil_id: string; tipo: string; tramite_id: string | null; mensaje: string; created_at: string; leida_at: string | null }[]
  /** Contraseña vigente del usuario: la acepta POST /auth/v1/token y la rechaza PUT /auth/v1/user como same_password. */
  claveActual?: string
}

class SaldoSinFixture extends Error {}

const ESTADOS_EN_CURSO = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro']

const nombreDe = (lista: Fila[], id: unknown) => lista.find((x) => x.id === id)
const big = (x: unknown) => BigInt(String(x))

function errorNegocio(route: Route, message: string) {
  return route.fulfill({ status: 400, json: { code: 'P0001', message, details: null, hint: null } })
}

// --- Filtros PostgREST mínimos: eq, neq, in, gt, gte, lt, lte, ilike, is, or=(...), and(...) ----
function partirNivelSuperior(s: string): string[] {
  const partes: string[] = []
  let prof = 0
  let actual = ''
  for (const c of s) {
    if (c === '(') prof++
    if (c === ')') prof--
    if (c === ',' && prof === 0) {
      partes.push(actual)
      actual = ''
    } else actual += c
  }
  if (actual) partes.push(actual)
  return partes
}

function cumple(fila: Fila, col: string, expr: string): boolean {
  const [op, ...resto] = expr.split('.')
  const valor = resto.join('.')
  const v = fila[col]
  switch (op) {
    case 'eq':
      return String(v) === valor
    case 'neq':
      return String(v) !== valor
    case 'in':
      return valor.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v))
    case 'gt':
      return v != null && big(v) > big(valor)
    case 'gte':
      return v != null && String(v) >= valor
    case 'lt':
      return v != null && String(v) < valor
    case 'lte':
      return v != null && String(v) <= valor
    case 'is':
      return valor === 'null' ? v == null : String(v) === valor
    case 'not':
      return !cumple(fila, col, valor)
    case 'ilike': {
      const re = new RegExp('^' + valor.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      return v != null && re.test(String(v))
    }
    default:
      throw new Error(`Operador no soportado en el mock: ${op}`)
  }
}

function cumpleCondicion(fila: Fila, cond: string): boolean {
  const m = /^(and|or)\((.*)\)$/.exec(cond)
  if (m) {
    const partes = partirNivelSuperior(m[2])
    return m[1] === 'and' ? partes.every((p) => cumpleCondicion(fila, p)) : partes.some((p) => cumpleCondicion(fila, p))
  }
  const i = cond.indexOf('.')
  return cumple(fila, cond.slice(0, i), cond.slice(i + 1))
}

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'columns'])

function filtrar(filas: Fila[], params: URLSearchParams): Fila[] {
  let r = filas
  for (const [k, v] of params) {
    if (RESERVADOS.has(k)) continue
    if (k === 'or' || k === 'and') r = r.filter((f) => cumpleCondicion(f, `${k}${v}`))
    else r = r.filter((f) => cumple(f, k, v))
  }
  return r
}

// --- Servidor ----------------------------------------------------------------------------------
export function crearServidor(semillas: Semilla[] = [], extra: Extra = {}): Servidor {
  let tic = 0
  const sockets = new Set<Socket>()
  return {
    situacionForzada: new Map(semillas.filter((s) => s.situacion).map((s) => [s.tramite.id, s.situacion!])),
    st: {
      operaciones: [...new Map(semillas.map((s) => [s.operacion.id, { ...s.operacion }])).values()],
      tramites: semillas.map((s) => ({ ...s.tramite })),
      marcas: semillas.flatMap((s) =>
        (s.marcas ?? []).map((marca) => ({ tramite_id: s.tramite.id, marca, at: catalogos.ahora, por: s.tramite.gestora_id }))),
      eventos: [],
      presupuestos: semillas.flatMap((s) =>
        (s.presupuestos ?? []).map((total, i) => ({ tramite_id: s.tramite.id, version: i + 1, total }))),
      aprobaciones: semillas.filter((s) => s.aprobado && s.presupuestos?.length)
        .map((s) => ({ tramite_id: s.tramite.id, version: s.presupuestos!.length })),
      movimientos: (extra.movimientos ?? []).map((m) => ({ ...m })),
      conciliaciones: (extra.conciliaciones ?? []).map((c) => ({ ...c })),
      siguienteEvento: 1,
      rendiciones: (extra.rendiciones ?? []).map((x) => ({ ...x })),
      rendicionFilas: (extra.rendicionFilas ?? []).map((x) => ({ ...x })),
      comprobantes: (extra.comprobantes ?? []).map((x) => ({ ...x })),
      comprobanteLineas: (extra.comprobanteLineas ?? []).map((x) => ({ ...x })),
      archivos: new Map(),
    },
    sockets,
    siguienteInstante: () => new Date(Date.parse(catalogos.ahora) + ++tic * 1000).toISOString(),
    // Emite un postgres_changes a cada canal suscripto a la tabla (como el publication supabase_realtime).
    notificar(tabla) {
      for (const s of sockets)
        for (const [topic, canal] of s.canales) {
          const ids = canal.bindings.filter((b) => b.table === tabla || b.table === '*').map((b) => b.id)
          if (!ids.length) continue
          s.enviar([canal.joinRef, null, topic, 'postgres_changes', {
            ids,
            data: { schema: 'public', table: tabla, commit_timestamp: catalogos.ahora, type: 'INSERT', columns: [], record: {}, errors: null },
          }])
        }
    },
  }
}

// --- Mock --------------------------------------------------------------------------------------
export async function montarSupabase(page: Page, semillas: Semilla[] = [], opciones: OpcionesMock = {}) {
  const ahora = catalogos.ahora
  const hoy = ahora.slice(0, 10)
  const yo = opciones.usuario ?? sesion.user.id
  // Perfiles y alcances mutables: la pantalla de Usuarios los edita por RPC / Edge Function.
  const perfiles: Fila[] = [...catalogos.perfiles, ...(opciones.perfilesExtra ?? [])].map((p) => ({ ...p }))
  const tablaAlcances: Fila[] = (opciones.tablaAlcances ?? []).map((a) => ({ ...a }))
  /** Cuerpos recibidos por la Edge Function invitar-usuario. */
  const invitaciones: Fila[] = []
  /** Pedidos a /auth/v1/recover (email + redirect_to) y cuerpos de PUT /auth/v1/user. */
  const recuperaciones: Fila[] = []
  const cambiosClave: Fila[] = []
  let claveActual = opciones.claveActual ?? 'ClaveVigente-2026'
  const rol = perfiles.find((p) => p.id === yo)?.rol as string | undefined
  const sesionActiva = { ...sesion, user: { ...sesion.user, id: yo } }
  const rutasPedidas: string[] = []
  /** URL completa (con select y filtros) de cada pedido, para verificar qué columnas se piden. */
  const urlsPedidas: string[] = []
  const alcances = opciones.alcances
  const tieneAlcance = (empresa: unknown, sucursal: unknown) =>
    !alcances || alcances.some((a) => a.empresa_id === empresa && (a.sucursal_id == null || a.sucursal_id === sucursal))
  const veTramite = (t: Fila) => rol === 'gestora' || tieneAlcance(t.empresa_id, t.sucursal_id)
  const servidor = opciones.servidor ?? crearServidor(semillas)
  const notificaciones: Fila[] = (opciones.notificaciones ?? []).map((n) => ({ ...n }))
  /** Simula el trigger: inserta una notificación y la emite por Realtime. */
  const agregarNotificacion = (n: Fila) => {
    notificaciones.push({ leida_at: null, tramite_id: null, perfil_id: yo, created_at: ahora, ...n })
    servidor.notificar('notificaciones')
  }
  const { st, situacionForzada } = servidor

  function estadoPrevioDe(id: unknown): string | null {
    const ev = [...st.eventos].reverse().find((e) => e.entidad === 'tramites' && e.entidad_id === id && e.estado_despues === 'suspendido' && e.estado_antes !== 'suspendido')
    return ev ? String(ev.estado_antes) : null
  }
  function registrarEvento(e: Fila) {
    st.eventos.push({ id: st.siguienteEvento++, at: ahora, actor_id: yo, motivo: null, ...e })
  }

  function vistaTramite(t: Fila): Fila {
    const op = nombreDe(st.operaciones, t.operacion_id)!
    const tipo = nombreDe(catalogos.tipos_tramite, t.tipo_id)!
    const emp = nombreDe(catalogos.empresas, op.empresa_id)!
    const suc = nombreDe(catalogos.sucursales, op.sucursal_id)!
    return {
      ...t,
      tipo: { codigo: tipo.codigo, nombre: tipo.nombre },
      operacion: {
        cliente_nombre: op.cliente_nombre,
        cuenta_personal: op.cuenta_personal,
        oferta_ref: op.oferta_ref,
        empresa: { nombre: emp.nombre },
        sucursal: { nombre: suc.nombre, provincia: suc.provincia },
      },
      marcas: st.marcas.filter((m) => m.tramite_id === t.id).map(({ marca, at, por }) => ({ marca, at, por })),
      presupuestos: st.presupuestos.filter((p) => p.tramite_id === t.id)
        .map((p) => ({ version: p.version, total: p.total, motivo: p.motivo ?? null, created_at: p.created_at ?? ahora })),
    }
  }

  function tramite(id: unknown) {
    return st.tramites.find((t) => t.id === id)
  }

  const revertido = (m: Fila) => st.movimientos.some((r) => r.revierte_id === m.id)

  // Réplica simplificada de v_tramite_finanzas (sin_fondos llega forzado por semilla). Las filas
  // traen los alias ::text que piden las consultas y comprometido_cents para filtrar.
  function finanzas(t: Fila): Fila {
    const versiones = st.presupuestos.filter((p) => p.tramite_id === t.id)
    const presupuesto = versiones.length ? String(versiones[versiones.length - 1].total) : null
    const movs = st.movimientos.filter((m) => m.tramite_id === t.id)
    const pagado = -movs.reduce((s, m) => s + big(m.importe), 0n)
    const pagoFinal = movs.some((m) => m.es_pago_final && !revertido(m))
    const enCurso = ESTADOS_EN_CURSO.includes(String(t.estado))
    const comprometido = enCurso && !pagoFinal && presupuesto && big(presupuesto) > pagado ? big(presupuesto) - pagado : 0n
    let situacion = 'no_aplica'
    if (pagoFinal) situacion = 'pagado'
    else if (situacionForzada.has(t.id)) situacion = situacionForzada.get(t.id)!
    else if (comprometido > 0n && pagado <= 0n) situacion = 'comprometido'
    else if (enCurso && !presupuesto) situacion = 'sin_presupuesto'
    else if (enCurso && pagado > 0n) situacion = 'pagado_parcial'
    const version = versiones.length || null
    const aprobado = version != null && st.aprobaciones.some((a) => a.tramite_id === t.id && a.version === version)
    return {
      tramite_id: t.id, empresa_id: t.empresa_id, presupuesto, pagado: String(pagado),
      comprometido: String(comprometido), comprometido_cents: String(comprometido), situacion,
      presupuesto_version: version, presupuesto_aprobado: aprobado,
    }
  }

  function cuentaDe(empresa: unknown) {
    return catalogos.cuentas.find((c) => c.empresa_id === empresa)!
  }

  function saldos(): Fila[] {
    return catalogos.cuentas.map((c) => {
      const registrado = big(c.saldo_inicial) +
        st.movimientos.filter((m) => m.cuenta_id === c.id).reduce((s, m) => s + big(m.importe), 0n)
      const comprometido = st.tramites.filter((t) => t.empresa_id === c.empresa_id)
        .reduce((s, t) => s + big(finanzas(t).comprometido), 0n)
      const ultima = st.conciliaciones.filter((k) => k.cuenta_id === c.id)
        .sort((a, b) => String(b.fecha_corte).localeCompare(String(a.fecha_corte)))[0]
      return {
        cuenta_id: c.id, empresa_id: c.empresa_id, empresa: nombreDe(catalogos.empresas, c.empresa_id)!.nombre,
        registrado: String(registrado), comprometido: String(comprometido), disponible: String(registrado - comprometido),
        ultima_conciliacion_fecha: ultima?.fecha_corte ?? null, ultima_diferencia: ultima ? String(ultima.diferencia) : null,
      }
    })
  }

  function extracto(): Fila[] {
    const orden = [...st.movimientos].sort((a, b) =>
      String(a.fecha_operacion).localeCompare(String(b.fecha_operacion)) ||
      String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    const acum = new Map<unknown, bigint>()
    return orden.map((m) => {
      const c = catalogos.cuentas.find((x) => x.id === m.cuenta_id)!
      const imp = big(m.importe)
      const saldo = (acum.get(c.id) ?? big(c.saldo_inicial)) + imp
      acum.set(c.id, saldo)
      const t = m.tramite_id ? tramite(m.tramite_id) : undefined
      return {
        movimiento_id: m.id, cuenta_id: m.cuenta_id, fecha_operacion: m.fecha_operacion, tipo: m.tipo,
        tramite_numero: t?.numero ?? null,
        cliente: t ? nombreDe(st.operaciones, t.operacion_id)!.cliente_nombre : null,
        responsable: nombreDe(catalogos.perfiles, m.creado_por)!.nombre,
        ingreso: String(imp > 0n ? imp : 0n), egreso: String(imp < 0n ? -imp : 0n), saldo: String(saldo),
        conciliado: st.conciliaciones.some((k) => (k.movimientos as string[]).includes(String(m.id))),
        created_at: m.created_at,
      }
    })
  }

  /** Inserta un movimiento (idempotente por idem) y lo publica por Realtime. */
  function nuevoMovimiento(m: Fila): Fila {
    const existente = st.movimientos.find((x) => x.idem != null && x.idem === m.idem)
    if (existente) return existente
    const n = st.movimientos.length + 1
    const mov = {
      id: `00000000-0000-4000-8000-00000000${String(n).padStart(3, '0')}f`, revierte_id: null, tramite_id: null,
      es_pago_final: false, creado_por: yo, created_at: servidor.siguienteInstante(), ...m,
    }
    st.movimientos.push(mov)
    servidor.notificar('movimientos')
    return mov
  }

  function conceptos(a: Fila): bigint | null {
    const v = [a.p_arancel, a.p_prenda, a.p_sellado, a.p_otros]
    if (v.some((x) => x == null || !/^\d+$/.test(String(x)))) return null
    return v.reduce<bigint>((s, x) => s + big(x), 0n)
  }

  const importe = (x: unknown) => (/^-?\d+$/.test(String(x ?? '')) ? big(x) : null)
  const conMotivo = (a: Fila) => String(a.p_motivo ?? '').trim() !== ''

  const gestionaUsuarios = () => rol === 'admin' || rol === 'gerencia'
  const reemplazarAlcances = (perfil: string, lista: unknown) => {
    for (let i = tablaAlcances.length - 1; i >= 0; i--) if (tablaAlcances[i].perfil_id === perfil) tablaAlcances.splice(i, 1)
    for (const a of (lista ?? []) as Fila[]) tablaAlcances.push({ perfil_id: perfil, empresa_id: a.empresa_id, sucursal_id: a.sucursal_id ?? null })
  }
  // --- Rendiciones (réplica de 20261101000100_rendiciones.sql y 20261101000200_controles_rendicion.sql) ---
  function rendicion(id: unknown) {
    return st.rendiciones.find((r) => r.id === id)
  }
  function veRendicion(r: Fila | undefined): boolean {
    if (!r) return false
    if (rol === 'gestora') return r.gestora_id === yo
    if (rol === 'gerencia' || rol === 'contable') return tieneAlcance(r.empresa_id, null)
    return false
  }
  const nuevoId = () => crypto.randomUUID()
  const textoONull = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim())

  /** Igual que rendicion_editable(): existe, la ve y está en borrador u observada. */
  function editable(route: Route, id: unknown): Fila | null {
    const r = rendicion(id)
    if (!r || !veRendicion(r)) {
      void errorNegocio(route, 'NO_ENCONTRADO: rendición inexistente')
      return null
    }
    if (!['borrador', 'observada'].includes(String(r.estado))) {
      void errorNegocio(route, `TRANSICION_INVALIDA: la rendición está ${r.estado}; solo se edita en borrador u observada`)
      return null
    }
    return r
  }

  function controlesDe(r: Fila): Fila {
    const filas = st.rendicionFilas.filter((f) => f.rendicion_id === r.id).sort((a, b) => Number(a.orden) - Number(b.orden))
    const comps = st.comprobantes.filter((c) => c.rendicion_id === r.id)
    const esFactura = (c: Fila) => ['factura_honorarios', 'factura_electronica'].includes(String(c.tipo))
    const porFila = filas.map((f) => {
      const comp = comps.filter((c) => c.fila_id === f.id && !esFactura(c)).reduce((s, c) => s + (c.total == null ? 0n : big(c.total)), 0n)
      const pago = big(f.pago)
      return { fila_id: f.id, nombre: f.nombre, pago_cents: String(pago), comprobantes_cents: String(comp), diferencia_cents: String(comp - pago), ok: comp === pago }
    })
    const total = filas.reduce((s, f) => s + big(f.pago), 0n)
    const mes = String(r.periodo).slice(0, 7)
    const cuenta = cuentaDe(r.empresa_id)
    const pagos = st.movimientos.filter((m) => m.cuenta_id === cuenta.id && m.tipo === 'pago_tramite' &&
      String(m.fecha_operacion).slice(0, 7) === mes && !revertido(m))
    const debitado = -pagos.reduce((s, m) => s + big(m.importe), 0n)
    const vinculados = new Set(filas.map((f) => f.tramite_id).filter(Boolean))
    const sinRendir = pagos.filter((m) => !vinculados.has(m.tramite_id)).map((m) => ({
      movimiento_id: m.id, fecha: m.fecha_operacion, importe_cents: String(-big(m.importe)),
      tramite_id: m.tramite_id, tramite_numero: tramite(m.tramite_id)?.numero ?? null,
    }))
    const noAut = filas.flatMap((f) => {
      const t = f.tramite_id ? tramite(f.tramite_id) : undefined
      const motivo = !f.tramite_id ? (f.vinculo === 'ambiguo' ? 'ambiguo' : 'sin_vincular')
        : !t || !t.autorizado_at || ['cancelado', 'rechazado'].includes(String(t.estado)) ? 'no_autorizado' : null
      return motivo ? [{ fila_id: f.id, nombre: f.nombre, motivo }] : []
    })
    const esperado = BigInt(filas.length) * big(r.honorario)
    const facturado = comps.filter((c) => esFactura(c) && c.revision === 'confirmado').reduce((s, c) => s + (c.total == null ? 0n : big(c.total)), 0n)
    return {
      importes: {
        filas: porFila, total_planilla_cents: String(total), debitado_habitualista_cents: String(debitado),
        diferencia_cents: String(total - debitado), movimientos_sin_rendir: sinRendir,
        ok: porFila.every((f) => f.ok) && total === debitado,
      },
      autorizados: { filas_no_autorizadas: noAut, ok: noAut.length === 0 },
      honorarios: {
        cantidad_tramites: filas.length, honorario_unitario_cents: String(r.honorario), esperado_cents: String(esperado),
        facturado_cents: String(facturado), diferencia_cents: String(facturado - esperado), ok: facturado === esperado,
      },
    }
  }

  function rpcsRendiciones(): Record<string, (route: Route, a: Fila) => Promise<void>> {
    return {
      async crear_rendicion(route, a) {
        let gestora: unknown
        if (rol === 'gestora') gestora = yo
        else if (rol === 'gerencia' || rol === 'contable') {
          if (!tieneAlcance(a.p_empresa, null)) return errorNegocio(route, 'SIN_PERMISO: sin alcance sobre esa razón social')
          const g = perfiles.find((p) => p.id === a.p_gestora && p.rol === 'gestora' && p.activo)
          if (!g) return errorNegocio(route, 'DATO_INVALIDO: elegí una gestora activa')
          gestora = g.id
        } else return errorNegocio(route, 'SIN_PERMISO: solo la gestora, gerencia o contable crean rendiciones')
        if (!a.p_periodo) return errorNegocio(route, 'DATO_INVALIDO: el mes de la rendición es obligatorio')
        const hon = importe(a.p_honorario ?? '3250000')
        if (hon == null || hon <= 0n) return errorNegocio(route, 'DATO_INVALIDO: el honorario debe ser mayor a cero')
        const periodo = `${String(a.p_periodo).slice(0, 7)}-01`
        if (st.rendiciones.some((r) => r.empresa_id === a.p_empresa && r.gestora_id === gestora && r.periodo === periodo))
          return errorNegocio(route, 'DUPLICADO: ya existe la rendición de ese mes para esa gestora y razón social')
        const r = {
          id: nuevoId(), empresa_id: a.p_empresa, gestora_id: gestora, periodo, honorario: String(hon), estado: 'borrador',
          motivo_observacion: null, creado_por: yo, created_at: servidor.siguienteInstante(), version: 1,
        }
        st.rendiciones.push(r)
        await route.fulfill({ json: r.id })
      },
      async guardar_filas(route, a) {
        const r = editable(route, a.p_rendicion)
        if (!r) return
        const lista = (a.p_filas ?? []) as Fila[]
        const ids: unknown[] = []
        for (const [i, f] of lista.entries()) {
          if (!textoONull(f.nombre)) return errorNegocio(route, `DATO_INVALIDO: la fila ${i + 1} no tiene nombre`)
          if (f.tramite_id && tramite(f.tramite_id)?.empresa_id !== r.empresa_id)
            return errorNegocio(route, `DATO_INVALIDO: el trámite de la fila ${i + 1} no es de esa razón social`)
        }
        for (const [i, f] of lista.entries()) {
          const datos = {
            orden: i + 1, nombre: String(f.nombre).trim(), dominio: textoONull(f.dominio)?.toUpperCase() ?? null,
            pago: String(importe(f.pago_cents) ?? 0n), honorarios: String(importe(f.honorarios_cents) ?? 0n),
            tramite_id: f.tramite_id ?? null, vinculo: f.vinculo ?? (f.tramite_id ? 'manual' : 'sin_vincular'),
            candidatos: (f.candidatos ?? []) as string[],
          }
          const existente = st.rendicionFilas.find((x) => x.id === f.id && x.rendicion_id === r.id)
          if (existente) Object.assign(existente, datos)
          else st.rendicionFilas.push({ id: nuevoId(), rendicion_id: r.id, ...datos })
          ids.push(existente?.id ?? st.rendicionFilas[st.rendicionFilas.length - 1].id)
        }
        for (let i = st.rendicionFilas.length - 1; i >= 0; i--) {
          const f = st.rendicionFilas[i]
          if (f.rendicion_id === r.id && !ids.includes(f.id)) {
            for (const c of st.comprobantes) if (c.fila_id === f.id) c.fila_id = null
            st.rendicionFilas.splice(i, 1)
          }
        }
        await route.fulfill({ status: 204, body: '' })
      },
      async guardar_comprobante(route, a) {
        const r = editable(route, a.p_rendicion)
        if (!r) return
        const d = (a.p_datos ?? {}) as Fila
        if (d.fila_id && !st.rendicionFilas.some((f) => f.id === d.fila_id && f.rendicion_id === r.id))
          return errorNegocio(route, 'DATO_INVALIDO: la fila no es de esta rendición')
        if (d.archivo_path && String(d.archivo_path).split('/')[0] !== r.id)
          return errorNegocio(route, 'DATO_INVALIDO: el archivo no es de esta rendición')
        const revision = String(d.revision ?? 'pendiente')
        let c = d.id ? st.comprobantes.find((x) => x.id === d.id) : undefined
        if (c && c.rendicion_id !== r.id) return errorNegocio(route, 'NO_ENCONTRADO: comprobante inexistente en esta rendición')
        const campos = {
          fila_id: d.fila_id ?? null, numero: textoONull(d.numero), emisor: textoONull(d.emisor), emisor_cuit: textoONull(d.emisor_cuit),
          fecha: textoONull(d.fecha), total: textoONull(d.total_cents), dominio: textoONull(d.dominio)?.toUpperCase() ?? null,
          documento: textoONull(d.documento), revision, revisado_por: revision === 'confirmado' ? yo : null,
        }
        if (c) {
          Object.assign(c, campos, {
            tipo: d.tipo ?? c.tipo, archivo_path: d.archivo_path ?? c.archivo_path, archivo_sha256: d.archivo_sha256 ?? c.archivo_sha256,
            pagina: d.pagina ?? c.pagina, datos_extraidos: d.datos_extraidos ?? c.datos_extraidos,
          })
        } else {
          c = {
            id: d.id ?? nuevoId(), rendicion_id: r.id, tipo: d.tipo ?? 'otro', archivo_path: d.archivo_path ?? null,
            archivo_sha256: d.archivo_sha256 ?? null, pagina: d.pagina ?? 1, datos_extraidos: d.datos_extraidos ?? {},
            cargado_por: yo, created_at: servidor.siguienteInstante(), ...campos,
          }
          st.comprobantes.push(c)
        }
        if ('lineas' in d) {
          for (let i = st.comprobanteLineas.length - 1; i >= 0; i--)
            if (st.comprobanteLineas[i].comprobante_id === c.id) st.comprobanteLineas.splice(i, 1)
          for (const l of (d.lineas ?? []) as Fila[]) {
            if (!textoONull(l.concepto) || importe(l.importe_cents) == null)
              return errorNegocio(route, 'DATO_INVALIDO: cada línea necesita concepto e importe')
            st.comprobanteLineas.push({ id: nuevoId(), comprobante_id: c.id, concepto: String(l.concepto).trim(), importe: String(importe(l.importe_cents)) })
          }
        }
        await route.fulfill({ json: c.id })
      },
      async cambiar_estado_rendicion(route, a) {
        const r = rendicion(a.p_rendicion)
        if (!r || !veRendicion(r)) return errorNegocio(route, 'NO_ENCONTRADO: rendición inexistente')
        const hacia = String(a.p_estado)
        if (hacia === 'enviada') {
          if (rol !== 'gestora') return errorNegocio(route, 'SIN_PERMISO: solo la gestora envía su rendición a control')
        } else if (hacia === 'observada' || hacia === 'aprobada') {
          if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable observan o aprueban rendiciones')
        } else return errorNegocio(route, 'DATO_INVALIDO: estado de rendición desconocido')
        if (r.version !== a.p_version) return errorNegocio(route, 'VERSION_CONFLICTO: otro usuario modificó esta rendición; recargá')
        if ((hacia === 'enviada' && !['borrador', 'observada'].includes(String(r.estado))) || (hacia !== 'enviada' && r.estado !== 'enviada'))
          return errorNegocio(route, `TRANSICION_INVALIDA: no se puede pasar de ${r.estado} a ${hacia}`)
        if (hacia === 'observada' && !conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: observar exige un motivo')
        Object.assign(r, { estado: hacia, version: Number(r.version) + 1, ...(hacia === 'observada' ? { motivo_observacion: String(a.p_motivo).trim() } : {}) })
        await route.fulfill({ status: 204, body: '' })
      },
      async controles_rendicion(route, a) {
        const r = rendicion(a.p_rendicion)
        if (!r || !veRendicion(r)) return errorNegocio(route, 'NO_ENCONTRADO: rendición inexistente')
        await route.fulfill({ json: controlesDe(r) })
      },
      async comprobantes_duplicados(route, a) {
        const r = rendicion(a.p_rendicion)
        if (!r || !veRendicion(r)) return errorNegocio(route, 'NO_ENCONTRADO: rendición inexistente')
        const visibles = st.comprobantes.filter((o) => veRendicion(rendicion(o.rendicion_id)))
        const res: Fila[] = []
        for (const c of st.comprobantes.filter((x) => x.rendicion_id === r.id)) {
          for (const o of visibles) {
            if (o.id === c.id) continue
            if (c.archivo_sha256 && o.archivo_sha256 === c.archivo_sha256 && Number(o.pagina) === Number(c.pagina))
              res.push({ comprobante_id: c.id, motivo: 'mismo_archivo', otro_id: o.id, otra_rendicion: o.rendicion_id })
            else if (c.numero && o.tipo === c.tipo && o.numero === c.numero && o.archivo_sha256 !== c.archivo_sha256 &&
              ((c.emisor_cuit && o.emisor_cuit === c.emisor_cuit) || String(o.emisor ?? '').toUpperCase() === String(c.emisor ?? '').toUpperCase()))
              res.push({ comprobante_id: c.id, motivo: 'mismo_numero', otro_id: o.id, otra_rendicion: o.rendicion_id })
          }
        }
        await route.fulfill({ json: res })
      },
    }
  }

  /** Storage del bucket privado comprobantes: subir (sin upsert), firmar URLs y descargar. */
  async function storage(route: Route, url: URL) {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' })
    const ruta = decodeURIComponent(url.pathname)
    const puede = (path: string) => veRendicion(rendicion(path.split('/')[0]))
    if (req.method() === 'POST' && ruta === '/storage/v1/object/sign/comprobantes') {
      const b = (req.postDataJSON() ?? {}) as { paths?: string[] }
      return route.fulfill({
        headers: cors,
        json: (b.paths ?? []).map((path) => puede(path) && st.archivos.has(path)
          ? { path, signedURL: `/object/sign/comprobantes/${path}?token=e2e`, error: null }
          : { path, signedURL: null, error: 'Object not found' }),
      })
    }
    const sub = /^\/storage\/v1\/object\/comprobantes\/(.+)$/.exec(ruta)
    if (sub && req.method() === 'POST') {
      const path = sub[1]
      if (!puede(path)) return route.fulfill({ status: 400, headers: cors, json: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } })
      if (st.archivos.has(path)) return route.fulfill({ status: 400, headers: cors, json: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } })
      let cuerpo = req.postDataBuffer() ?? Buffer.alloc(0)
      let tipo = req.headers()['content-type'] ?? 'application/octet-stream'
      // supabase-js sube los Blob como multipart: se guarda solo la parte del archivo.
      const borde = /boundary=(.+)$/.exec(tipo)?.[1]
      if (borde) {
        const texto = cuerpo.toString('latin1')
        const parte = texto.split(`--${borde}`).find((p) => /filename=/.test(p))
        if (parte) {
          const [cab, ...resto] = parte.split('\r\n\r\n')
          tipo = /Content-Type:\s*([^\r\n]+)/i.exec(cab)?.[1] ?? 'application/octet-stream'
          cuerpo = Buffer.from(resto.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1')
        }
      }
      st.archivos.set(path, { cuerpo, tipo })
      return route.fulfill({ headers: cors, json: { Key: `comprobantes/${path}`, Id: nuevoId() } })
    }
    const firmado = /^\/storage\/v1\/object\/sign\/comprobantes\/(.+)$/.exec(ruta)
    if (firmado && req.method() === 'GET') {
      const a = st.archivos.get(firmado[1])
      if (!a) return route.fulfill({ status: 404, headers: cors, body: '' })
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': a.tipo }, body: a.cuerpo })
    }
    throw new Error(`Ruta de storage sin mock: ${req.method()} ${ruta}`)
  }

  const rpcs: Record<string, (route: Route, a: Fila) => Promise<void>> = {
    async crear_usuario(route, a) {
      if (!gestionaUsuarios()) return errorNegocio(route, 'SIN_PERMISO: solo administración o gerencia gestionan usuarios')
      const email = String(a.p_email ?? '').trim().toLowerCase()
      const clave = String(a.p_clave ?? '')
      if (clave.length < 10 || !/[A-Za-z]/.test(clave) || !/[0-9]/.test(clave))
        return errorNegocio(route, 'DATO_INVALIDO: la contraseña inicial necesita al menos 10 caracteres, con letras y números')
      if (email === 'repetido@grupoparis.com.ar') return errorNegocio(route, 'DUPLICADO: ya existe un usuario con ese email')
      invitaciones.push({ email, nombre: a.p_nombre, rol: a.p_rol, alcances: a.p_alcances, clave })
      const id = `00000000-0000-4000-8000-${String(700 + perfiles.length).padStart(12, '0')}`
      perfiles.push({ id, nombre: String(a.p_nombre), rol: String(a.p_rol), activo: true, debe_cambiar_clave: true })
      reemplazarAlcances(id, a.p_alcances)
      await route.fulfill({ json: id })
    },
    async emails_usuarios(route) {
      if (!gestionaUsuarios()) return route.fulfill({ json: [] })
      const slug = (n: unknown) => String(n).toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.')
      await route.fulfill({
        json: perfiles.map((p) => ({
          id: p.id, email: p.email ?? `${slug(p.nombre)}@grupoparis.com.ar`,
          ultimo_ingreso: p.debe_cambiar_clave ? null : '2026-10-27T12:00:00.000Z', debe_cambiar_clave: !!p.debe_cambiar_clave,
        })),
      })
    },
    async restablecer_clave(route, a) {
      if (!gestionaUsuarios()) return errorNegocio(route, 'SIN_PERMISO: solo administración o gerencia gestionan usuarios')
      if (a.p_perfil === yo) return errorNegocio(route, 'DATO_INVALIDO: tu propia contraseña la cambiás desde "Cambiar contraseña"')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: indicá el motivo')
      const p = perfiles.find((x) => x.id === a.p_perfil)
      if (!p) return errorNegocio(route, 'NO_ENCONTRADO: usuario inexistente')
      p.debe_cambiar_clave = true
      invitaciones.push({ restablecer: p.id, clave: a.p_clave })
      await route.fulfill({ status: 204, body: '' })
    },
    async clave_cambiada(route) {
      const p = perfiles.find((x) => x.id === yo)
      if (p) p.debe_cambiar_clave = false
      await route.fulfill({ status: 204, body: '' })
    },
    async editar_usuario(route, a) {
      if (!gestionaUsuarios()) return errorNegocio(route, 'SIN_PERMISO: solo administración o gerencia gestionan usuarios')
      const p = perfiles.find((x) => x.id === a.p_perfil)
      if (!p) return errorNegocio(route, 'NO_ENCONTRADO: usuario inexistente')
      if (rol === 'gerencia' && (p.rol === 'admin' || a.p_rol === 'admin')) return errorNegocio(route, 'SIN_PERMISO: gerencia no gestiona administradores')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo del cambio es obligatorio')
      if (p.id === yo && a.p_rol !== p.rol) return errorNegocio(route, 'DATO_INVALIDO: no podés cambiarte el rol a vos mismo')
      Object.assign(p, { nombre: String(a.p_nombre).trim(), rol: a.p_rol })
      reemplazarAlcances(String(p.id), a.p_alcances)
      registrarEvento({ entidad: 'perfiles', entidad_id: p.id, accion: 'update', motivo: a.p_motivo })
      await route.fulfill({ status: 204, body: '' })
    },
    async cambiar_activo_usuario(route, a) {
      if (!gestionaUsuarios()) return errorNegocio(route, 'SIN_PERMISO: solo administración o gerencia gestionan usuarios')
      const p = perfiles.find((x) => x.id === a.p_perfil)
      if (!p) return errorNegocio(route, 'NO_ENCONTRADO: usuario inexistente')
      if (p.id === yo) return errorNegocio(route, 'DATO_INVALIDO: no podés desactivarte a vos mismo')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo es obligatorio')
      p.activo = !!a.p_activo
      registrarEvento({ entidad: 'perfiles', entidad_id: p.id, accion: 'update', motivo: a.p_motivo })
      await route.fulfill({ status: 204, body: '' })
    },
    async crear_tramite(route, a) {
      if (!tieneAlcance(a.p_empresa, a.p_sucursal))
        return errorNegocio(route, 'SIN_PERMISO: sin alcance sobre esa razón social y sucursal')
      const tipo = catalogos.tipos_tramite.find((t) => t.codigo === a.p_tipo)!
      const dominio = a.p_dominio ? String(a.p_dominio).trim().toUpperCase() : null
      let op = st.operaciones.find((o) => o.empresa_id === a.p_empresa && o.oferta_ref === a.p_oferta)
      const dup = op && st.tramites.find(
        (t) => t.operacion_id === op!.id && t.tipo_id === tipo.id && (t.dominio ?? '') === (dominio ?? '') &&
          !['cancelado', 'rechazado'].includes(String(t.estado)),
      )
      if (dup) return errorNegocio(route, `DUPLICADO: ya existe ${dup.numero}`)
      if (!op) {
        op = {
          id: `00000000-0000-4000-8000-${String(900 + st.operaciones.length).padStart(12, '0')}`,
          empresa_id: a.p_empresa, sucursal_id: a.p_sucursal, cliente_nombre: a.p_cliente,
          cuenta_personal: a.p_cuenta_personal, oferta_ref: a.p_oferta, referencia_mail: null, created_at: ahora,
        }
        st.operaciones.push(op)
      }
      const n = st.tramites.length + 1
      const t = {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        numero: `T-2026-${String(n).padStart(5, '0')}`,
        operacion_id: op.id, tipo_id: tipo.id, empresa_id: a.p_empresa, sucursal_id: a.p_sucursal,
        estado: 'borrador', vehiculo_desc: a.p_vehiculo, dominio, chasis: a.p_chasis ?? null,
        gestora_id: null, autorizado_at: null, version: 1, created_at: ahora,
      }
      st.tramites.push(t)
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'insert', estado_antes: null, estado_despues: 'borrador', motivo: 'alta de trámite' })
      await route.fulfill({ json: t.id })
    },
    async buscar_duplicados(route, a) {
      const dominio = a.p_dominio ? String(a.p_dominio).trim().toUpperCase() : null
      const res = st.tramites
        .filter((t) => t.empresa_id === a.p_empresa && !['cancelado', 'rechazado'].includes(String(t.estado)))
        .filter((t) => nombreDe(st.operaciones, t.operacion_id)!.oferta_ref === a.p_oferta || (dominio && t.dominio === dominio))
        .map((t) => ({ id: t.id, numero: t.numero, estado: t.estado }))
      await route.fulfill({ json: res })
    },
    async autorizar_tramite(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (!tieneAlcance(t.empresa_id, t.sucursal_id))
        return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable con alcance autorizan trámites')
      if (t.version !== a.p_version) return errorNegocio(route, 'VERSION_CONFLICTO: recargá')
      if (t.estado !== 'borrador') return errorNegocio(route, `TRANSICION_INVALIDA: está ${t.estado}`)
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: 'autorizado', gestora_antes: t.gestora_id, gestora_despues: a.p_gestora, motivo: '' })
      Object.assign(t, { estado: 'autorizado', gestora_id: a.p_gestora, autorizado_at: ahora, version: Number(t.version) + 1 })
      await route.fulfill({ status: 204, body: '' })
    },
    async cambiar_estado(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (t.version !== a.p_version) return errorNegocio(route, 'VERSION_CONFLICTO: recargá')
      const motivo = String(a.p_motivo ?? '').trim()
      if (!motivo && ['observado', 'rechazado', 'suspendido', 'cancelado'].includes(String(a.p_estado)))
        return errorNegocio(route, 'DATO_INVALIDO: el motivo es obligatorio')
      const retrocesos = [['en_gestoria', 'autorizado'], ['presentado', 'autorizado'], ['presentado', 'en_gestoria'],
        ['finalizado_registro', 'presentado'], ['devuelto', 'finalizado_registro'], ['cerrado', 'devuelto']]
      if (!motivo && retrocesos.some(([d, h]) => d === t.estado && h === a.p_estado))
        return errorNegocio(route, `DATO_INVALIDO: indicá el motivo para volver de ${t.estado} a ${a.p_estado}`)
      const turnoGestora = [['autorizado', 'presentado'], ['en_gestoria', 'presentado'], ['presentado', 'finalizado_registro'],
        ['finalizado_registro', 'devuelto'], ['presentado', 'autorizado'], ['presentado', 'en_gestoria'],
        ['finalizado_registro', 'presentado'], ['devuelto', 'finalizado_registro']]
      if (rol !== 'gestora' && turnoGestora.some(([d, h]) => d === t.estado && h === a.p_estado))
        return errorNegocio(route, `SIN_PERMISO: su rol no puede pasar el trámite de ${t.estado} a ${a.p_estado}`)
      if (rol === 'gestora') {
        const permitidas = [['autorizado', 'presentado'], ['en_gestoria', 'presentado'], ['presentado', 'finalizado_registro'], ['finalizado_registro', 'devuelto'],
          ['presentado', 'autorizado'], ['finalizado_registro', 'presentado'], ['devuelto', 'finalizado_registro']]
        if (t.gestora_id !== yo || !permitidas.some(([d, h]) => d === t.estado && h === a.p_estado))
          return errorNegocio(route, `SIN_PERMISO: su rol no puede pasar el trámite de ${t.estado} a ${a.p_estado}`)
        if (a.p_estado === 'presentado') {
          if (!finanzas(t).presupuesto_aprobado) return errorNegocio(route, 'NO_AUTORIZADO: el presupuesto todavía no fue aprobado por la empresa')
          if (!st.marcas.some((m) => m.tramite_id === t.id && m.marca === 'retirado'))
            return errorNegocio(route, 'DATO_INVALIDO: primero marcá que retiraste el legajo')
        }
      }
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: a.p_estado, motivo })
      Object.assign(t, { estado: a.p_estado, version: Number(t.version) + 1 })
      await route.fulfill({ status: 204, body: '' })
    },
    async resumen_tablero(route, a) {
      const vis = st.tramites.filter(veTramite)
      const corte = Date.parse(String(a.p_corte))
      const filas = catalogos.empresas
        .filter((e) => (!alcances || alcances.some((x) => x.empresa_id === e.id)) || vis.some((t) => t.empresa_id === e.id))
        .map((e) => {
          const ts = vis.filter((t) => t.empresa_id === e.id).map((t) => ({ t, f: finanzas(t) }))
          const n = (pred: (x: { t: Fila; f: Fila }) => boolean) => ts.filter(pred).length
          const antes = (x: { t: Fila }) => ['autorizado', 'en_gestoria'].includes(String(x.t.estado))
          return {
            empresa_id: e.id, empresa: e.nombre,
            abiertos: n((x) => !['cerrado', 'cancelado', 'rechazado'].includes(String(x.t.estado))),
            por_aprobar: n((x) => antes(x) && x.f.presupuesto_version != null && !x.f.presupuesto_aprobado),
            listos: n((x) => antes(x) && !!x.f.presupuesto_aprobado),
            presentados: n((x) => x.t.estado === 'presentado'),
            finalizados: n((x) => x.t.estado === 'finalizado_registro'),
            devueltos: n((x) => x.t.estado === 'devuelto'),
            sin_fondos: n((x) => x.f.situacion === 'sin_fondos'),
            demorados: n((x) => antes(x) && !!x.t.autorizado_at && Date.parse(String(x.t.autorizado_at)) < corte),
          }
        })
        .sort((x, y) => x.empresa.localeCompare(y.empresa))
      await route.fulfill({ json: filas })
    },
    async tramites_intervencion(route, a) {
      const corte = Date.parse(String(a.p_corte))
      const filas = st.tramites
        .filter(veTramite)
        .filter((t) => !['cerrado', 'cancelado', 'rechazado'].includes(String(t.estado)))
        .map((t) => {
          const f = finanzas(t)
          const antes = ['autorizado', 'en_gestoria'].includes(String(t.estado))
          const motivos = [
            t.estado === 'observado' && 'observado',
            antes && f.presupuesto_version != null && !f.presupuesto_aprobado && 'por_aprobar',
            f.situacion === 'sin_fondos' && 'sin_fondos',
            antes && t.autorizado_at && Date.parse(String(t.autorizado_at)) < corte && 'demorado',
          ].filter(Boolean)
          const op = st.operaciones.find((o) => o.id === t.operacion_id)!
          return { id: t.id, numero: t.numero, cliente: op.cliente_nombre, empresa: nombreDe(catalogos.empresas, t.empresa_id)!.nombre, motivos }
        })
        .filter((t) => t.motivos.length)
        .sort((x, y) => String(x.numero).localeCompare(String(y.numero)))
      await route.fulfill({ json: filas })
    },
    async estado_previo_suspension(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      await route.fulfill({ json: estadoPrevioDe(t.id) })
    },
    async reanudar_tramite(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (rol === 'gestora' || !tieneAlcance(t.empresa_id, t.sucursal_id))
        return errorNegocio(route, 'SIN_PERMISO: solo la oficina reanuda trámites suspendidos')
      if (t.estado !== 'suspendido') return errorNegocio(route, 'TRANSICION_INVALIDA: el trámite no está suspendido')
      const motivo = String(a.p_motivo ?? '').trim()
      if (!motivo) return errorNegocio(route, 'DATO_INVALIDO: indicá el motivo para reanudar')
      const previo = estadoPrevioDe(t.id)
      if (!previo) return errorNegocio(route, 'NO_ENCONTRADO: no se encontró el estado previo a la suspensión')
      if (t.version !== a.p_version) return errorNegocio(route, 'VERSION_CONFLICTO: recargá')
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: previo, motivo })
      Object.assign(t, { estado: previo, version: Number(t.version) + 1 })
      await route.fulfill({ json: previo })
    },
    async marcar(route, a) {
      const tm = tramite(a.p_tramite)
      if (rol === 'gestora' && tm && ['autorizado', 'en_gestoria'].includes(String(tm.estado)) && !finanzas(tm).presupuesto_aprobado)
        return errorNegocio(route, 'NO_AUTORIZADO: esperá que la empresa apruebe el presupuesto antes de retirar el legajo')
      if (!st.marcas.some((m) => m.tramite_id === a.p_tramite && m.marca === a.p_marca)) {
        st.marcas.push({ tramite_id: a.p_tramite, marca: a.p_marca, at: ahora, por: yo })
        registrarEvento({ entidad: 'tramite_marcas', entidad_id: a.p_tramite, accion: 'insert', marca: a.p_marca, motivo: '' })
      }
      await route.fulfill({ status: 204, body: '' })
    },
    async registrar_presupuesto(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (!['autorizado', 'en_gestoria', 'presentado'].includes(String(t.estado)))
        return errorNegocio(route, `NO_AUTORIZADO: está ${t.estado}`)
      const total = conceptos(a)
      if (total == null || total <= 0n) return errorNegocio(route, 'DATO_INVALIDO: importes inválidos')
      const version = st.presupuestos.filter((p) => p.tramite_id === t.id).length + 1
      if (version >= 2 && !conMotivo(a))
        return errorNegocio(route, 'DATO_INVALIDO: una nueva versión del presupuesto requiere motivo')
      st.presupuestos.push({ tramite_id: t.id, version, total: String(total), motivo: a.p_motivo ?? null, created_at: ahora })
      servidor.notificar('presupuestos')
      await route.fulfill({ json: version })
    },
    async desmarcar(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (rol === 'gestora' && !(t.gestora_id === yo && a.p_marca === 'retirado' && ['autorizado', 'en_gestoria'].includes(String(t.estado))))
        return errorNegocio(route, `SIN_PERMISO: no puede quitar la marca ${a.p_marca} de este trámite`)
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: indicá por qué se quita la marca')
      const i = st.marcas.findIndex((m) => m.tramite_id === t.id && m.marca === a.p_marca)
      if (i < 0) return errorNegocio(route, 'NO_ENCONTRADO: el trámite no tiene esa marca')
      st.marcas.splice(i, 1)
      registrarEvento({ entidad: 'tramite_marcas', entidad_id: t.id, accion: 'delete', marca: a.p_marca, motivo: a.p_motivo })
      await route.fulfill({ status: 204, body: '' })
    },
    async revocar_aprobacion(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: no puede retirar la aprobación de este trámite')
      if (!['autorizado', 'en_gestoria'].includes(String(t.estado)))
        return errorNegocio(route, `TRANSICION_INVALIDA: el trámite ya se presentó (está ${t.estado}); primero volvelo atrás`)
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: indicá por qué se retira la aprobación')
      const antes = st.aprobaciones.length
      st.aprobaciones = st.aprobaciones.filter((x) => x.tramite_id !== t.id)
      if (st.aprobaciones.length === antes) return errorNegocio(route, 'NO_ENCONTRADO: el presupuesto vigente no está aprobado')
      await route.fulfill({ status: 204, body: '' })
    },
    async aprobar_presupuesto(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if ((rol !== 'gerencia' && rol !== 'contable') || !tieneAlcance(t.empresa_id, t.sucursal_id))
        return errorNegocio(route, 'SIN_PERMISO: no puede aprobar presupuestos de este trámite')
      if (!['autorizado', 'en_gestoria'].includes(String(t.estado)))
        return errorNegocio(route, `TRANSICION_INVALIDA: solo se aprueba el presupuesto antes de presentar (está ${t.estado})`)
      const f = finanzas(t)
      if (f.presupuesto_version == null) return errorNegocio(route, 'NO_ENCONTRADO: el trámite todavía no tiene presupuesto')
      if (f.presupuesto_version !== a.p_version)
        return errorNegocio(route, `VERSION_CONFLICTO: la gestora cambió el presupuesto (versión vigente ${f.presupuesto_version})`)
      if (f.situacion === 'sin_fondos')
        return errorNegocio(route, 'NO_AUTORIZADO: no hay fondos para este presupuesto; cargá fondos o aprobá la excepción')
      if (!f.presupuesto_aprobado) {
        st.aprobaciones.push({ tramite_id: t.id, version: f.presupuesto_version })
        if (t.gestora_id && t.gestora_id !== yo) servidor.notificar('notificaciones')
      }
      await route.fulfill({ status: 204, body: '' })
    },
    async saldos_gestora(route) {
      if (rol !== 'gestora') return route.fulfill({ json: [] })
      const mias = new Set(st.tramites.filter((t) => t.gestora_id === yo && ESTADOS_EN_CURSO.includes(String(t.estado))).map((t) => t.empresa_id))
      const filas = (opciones.saldosFijos ? opciones.saldosFijos(st) ?? [] : saldos())
        .filter((f) => mias.has(f.empresa_id))
        .map((f) => ({ empresa_id: f.empresa_id, empresa: f.empresa, disponible: f.disponible, comprometido: f.comprometido }))
      await route.fulfill({ json: filas })
    },
    async registrar_pago(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (!ESTADOS_EN_CURSO.includes(String(t.estado))) {
        // R24: fuera de curso solo paga la oficina, con motivo de excepción.
        if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, `NO_AUTORIZADO: está ${t.estado}`)
        if (!conMotivo(a)) return errorNegocio(route, `NO_AUTORIZADO: pagar un trámite ${t.estado} requiere motivo de excepción`)
      }
      const total = conceptos(a)
      if (total == null || total <= 0n) return errorNegocio(route, 'DATO_INVALIDO: importes inválidos')
      if (!a.p_fecha) return errorNegocio(route, 'DATO_INVALIDO: la fecha del pago es obligatoria')
      nuevoMovimiento({
        idem: a.p_idem, cuenta_id: cuentaDe(t.empresa_id).id, tipo: 'pago_tramite', importe: String(-total),
        fecha_operacion: a.p_fecha, tramite_id: t.id, es_pago_final: a.p_es_final === true,
      })
      await route.fulfill({ json: a.p_idem })
    },
    async registrar_carga(route, a) {
      if ((rol !== 'gerencia' && rol !== 'contable') || !tieneAlcance(a.p_empresa, null))
        return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable con alcance cargan fondos')
      const imp = importe(a.p_importe)
      if (imp == null || imp <= 0n) return errorNegocio(route, 'DATO_INVALIDO: el importe de la carga debe ser mayor a cero')
      if (!a.p_fecha) return errorNegocio(route, 'DATO_INVALIDO: la fecha de la carga es obligatoria')
      const m = nuevoMovimiento({ idem: a.p_idem, cuenta_id: cuentaDe(a.p_empresa).id, tipo: 'carga', importe: String(imp), fecha_operacion: a.p_fecha })
      // Aproximación de la base: una carga cubre a los trámites marcados sin fondos de esa empresa.
      for (const t of st.tramites)
        if (t.empresa_id === a.p_empresa && situacionForzada.get(t.id) === 'sin_fondos') situacionForzada.delete(t.id)
      await route.fulfill({ json: m.id })
    },
    async registrar_ajuste(route, a) {
      if (rol !== 'gerencia') return errorNegocio(route, 'SIN_PERMISO: solo gerencia con alcance ajusta saldos')
      const imp = importe(a.p_importe)
      if (imp == null || imp === 0n) return errorNegocio(route, 'DATO_INVALIDO: el importe del ajuste no puede ser cero')
      if (!a.p_fecha) return errorNegocio(route, 'DATO_INVALIDO: la fecha del ajuste es obligatoria')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo del ajuste es obligatorio')
      const m = nuevoMovimiento({ idem: a.p_idem, cuenta_id: cuentaDe(a.p_empresa).id, tipo: 'ajuste', importe: String(imp), fecha_operacion: a.p_fecha })
      await route.fulfill({ json: m.id })
    },
    async revertir_movimiento(route, a) {
      const previo = st.movimientos.find((x) => x.idem != null && x.idem === a.p_idem)
      if (previo) return route.fulfill({ json: previo.id })
      const m = st.movimientos.find((x) => x.id === a.p_movimiento)
      if (!m) return errorNegocio(route, 'NO_ENCONTRADO: movimiento inexistente')
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable')
      if (m.tipo === 'reversion') return errorNegocio(route, 'DATO_INVALIDO: una reversión no se revierte')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo de la reversión es obligatorio')
      if (revertido(m)) return errorNegocio(route, 'DUPLICADO: el movimiento ya fue revertido')
      const r = nuevoMovimiento({
        idem: a.p_idem, cuenta_id: m.cuenta_id, tipo: 'reversion', importe: String(-big(m.importe)),
        fecha_operacion: hoy, tramite_id: m.tramite_id, revierte_id: m.id,
      })
      await route.fulfill({ json: r.id })
    },
    async registrar_conciliacion(route, a) {
      if (!a.p_idem) return errorNegocio(route, 'DATO_INVALIDO: falta la clave de idempotencia')
      const previa = st.conciliaciones.find((x) => x.idem === a.p_idem)
      if (previa) return route.fulfill({ json: previa.id })
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable')
      const externo = importe(a.p_saldo_externo)
      if (!a.p_fecha_corte || externo == null)
        return errorNegocio(route, 'DATO_INVALIDO: la fecha de corte y el saldo externo son obligatorios')
      const c = cuentaDe(a.p_empresa)
      const interno = big(c.saldo_inicial) + st.movimientos
        .filter((m) => m.cuenta_id === c.id && String(m.fecha_operacion) <= String(a.p_fecha_corte))
        .reduce((s, m) => s + big(m.importe), 0n)
      const id = `00000000-0000-4000-8000-0000000c${String(st.conciliaciones.length + 1).padStart(4, '0')}`
      st.conciliaciones.push({
        id, idem: a.p_idem, cuenta_id: c.id, fecha_corte: a.p_fecha_corte, diferencia: String(externo - interno),
        movimientos: (a.p_movimientos as string[] | null) ?? [],
      })
      await route.fulfill({ json: id })
    },
    async aprobar_excepcion_fondos(route, a) {
      if (rol !== 'gerencia') return errorNegocio(route, 'SIN_PERMISO: solo gerencia aprueba excepciones')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo es obligatorio')
      situacionForzada.delete(a.p_tramite)
      await route.fulfill({ status: 204, body: '' })
    },
    async editar_tramite(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if ((rol !== 'gerencia' && rol !== 'contable') || !tieneAlcance(t.empresa_id, t.sucursal_id))
        return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable con alcance editan trámites')
      if (t.version !== a.p_version) return errorNegocio(route, 'VERSION_CONFLICTO: recargá')
      if (!['borrador', 'observado'].includes(String(t.estado)))
        return errorNegocio(route, `TRANSICION_INVALIDA: solo se edita un trámite en borrador u observado (está ${t.estado})`)
      const txt = (x: unknown) => String(x ?? '').trim()
      if (![a.p_cliente, a.p_cuenta_personal, a.p_oferta, a.p_vehiculo].every((x) => txt(x)))
        return errorNegocio(route, 'DATO_INVALIDO: cliente, cuenta personal, oferta y vehículo son obligatorios')
      let op = st.operaciones.find((o) => o.empresa_id === t.empresa_id && o.oferta_ref === txt(a.p_oferta))
      if (!op) {
        op = {
          id: `00000000-0000-4000-8000-${String(900 + st.operaciones.length).padStart(12, '0')}`,
          empresa_id: t.empresa_id, sucursal_id: t.sucursal_id, oferta_ref: txt(a.p_oferta), referencia_mail: null, created_at: ahora,
        }
        st.operaciones.push(op)
      }
      Object.assign(op, { cliente_nombre: txt(a.p_cliente), cuenta_personal: txt(a.p_cuenta_personal) })
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: t.estado, motivo: txt(a.p_motivo) || 'edición de trámite' })
      Object.assign(t, {
        operacion_id: op.id, vehiculo_desc: txt(a.p_vehiculo), dominio: txt(a.p_dominio).toUpperCase() || null,
        chasis: txt(a.p_chasis).toUpperCase() || null, version: Number(t.version) + 1,
      })
      servidor.notificar('tramites')
      await route.fulfill({ status: 204, body: '' })
    },
    async registrar_reintegro(route, a) {
      const t = tramite(a.p_tramite)
      if (!t) return errorNegocio(route, 'NO_ENCONTRADO: trámite inexistente')
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable registran reintegros')
      const imp = importe(a.p_importe)
      if (imp == null || imp <= 0n) return errorNegocio(route, 'DATO_INVALIDO: el importe del reintegro debe ser mayor a cero')
      if (!a.p_fecha) return errorNegocio(route, 'DATO_INVALIDO: la fecha del reintegro es obligatoria')
      if (!conMotivo(a)) return errorNegocio(route, 'DATO_INVALIDO: el motivo del reintegro es obligatorio')
      const m = nuevoMovimiento({ idem: a.p_idem, cuenta_id: cuentaDe(t.empresa_id).id, tipo: 'reintegro', importe: String(imp), fecha_operacion: a.p_fecha, tramite_id: t.id })
      await route.fulfill({ json: m.id })
    },
    // Réplicas de las RPC de informes: ya devuelven los alias ::text que pide el front.
    async informe_cierre_mensual(route, a) {
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable consultan informes')
      if (!a.p_mes) return errorNegocio(route, 'DATO_INVALIDO: el mes del informe es obligatorio')
      if (a.p_empresa && !tieneAlcance(a.p_empresa, null)) return errorNegocio(route, 'SIN_PERMISO: sin alcance sobre esa razón social')
      const mes = String(a.p_mes).slice(0, 7)
      const filas = catalogos.cuentas
        .filter((c) => tieneAlcance(c.empresa_id, null) && (!a.p_empresa || c.empresa_id === a.p_empresa))
        .map((c) => {
          const movs = st.movimientos.filter((m) => m.cuenta_id === c.id)
          const antes = movs.filter((m) => String(m.fecha_operacion).slice(0, 7) < mes)
          const enMes = movs.filter((m) => String(m.fecha_operacion).slice(0, 7) === mes)
          const suma = (l: Fila[]) => l.reduce((s, m) => s + big(m.importe), 0n)
          const porTipo = (t: string) => suma(enMes.filter((m) => m.tipo === t))
          const inicial = big(c.saldo_inicial) + suma(antes)
          return {
            mes: `${mes}-01`, empresa_id: c.empresa_id, empresa: nombreDe(catalogos.empresas, c.empresa_id)!.nombre, cuenta_id: c.id,
            saldo_inicial: String(inicial), cargas: String(porTipo('carga')), pagos: String(-porTipo('pago_tramite')),
            ajustes: String(porTipo('ajuste')), reintegros: String(porTipo('reintegro')), reversiones: String(porTipo('reversion')),
            saldo_final: String(inicial + suma(enMes)), movimientos: enMes.length,
          }
        })
        .sort((x, y) => x.empresa.localeCompare(y.empresa))
      await route.fulfill({ json: filas })
    },
    async informe_costos_tramites(route, a) {
      if (rol !== 'gerencia' && rol !== 'contable') return errorNegocio(route, 'SIN_PERMISO: solo gerencia o contable consultan informes')
      if (!a.p_mes) return errorNegocio(route, 'DATO_INVALIDO: el mes del informe es obligatorio')
      if (a.p_empresa && !tieneAlcance(a.p_empresa, null)) return errorNegocio(route, 'SIN_PERMISO: sin alcance sobre esa razón social')
      const mes = String(a.p_mes).slice(0, 7)
      const filas = st.tramites
        .filter((t) => tieneAlcance(t.empresa_id, t.sucursal_id) && (!a.p_empresa || t.empresa_id === a.p_empresa))
        .flatMap((t) => {
          const enMes = st.movimientos.filter((m) => m.tramite_id === t.id && String(m.fecha_operacion).slice(0, 7) === mes)
          if (!enMes.length) return []
          const f = finanzas(t)
          const pagoFinal = f.situacion === 'pagado'
          const desvio = pagoFinal && f.presupuesto != null ? big(f.pagado) - big(f.presupuesto as string) : null
          const pct = desvio != null && big(f.presupuesto as string) > 0n
            ? (Number((desvio * 10000n) / big(f.presupuesto as string)) / 100).toFixed(2) : null
          const op = nombreDe(st.operaciones, t.operacion_id)!
          return [{
            mes: `${mes}-01`, tramite_id: t.id, numero: t.numero, empresa_id: t.empresa_id,
            empresa: nombreDe(catalogos.empresas, t.empresa_id)!.nombre,
            sucursal: nombreDe(catalogos.sucursales, t.sucursal_id)!.nombre,
            tipo: nombreDe(catalogos.tipos_tramite, t.tipo_id)!.nombre, cliente: op.cliente_nombre,
            gestora: nombreDe(perfiles, t.gestora_id)?.nombre ?? null, estado: t.estado,
            presupuesto: f.presupuesto, costo_mes: String(-enMes.reduce((s, m) => s + big(m.importe), 0n)),
            pagado_total: f.pagado, pago_final: pagoFinal, desvio: desvio == null ? null : String(desvio), desvio_pct: pct,
          }]
        })
        .sort((x, y) => String(x.empresa).localeCompare(String(y.empresa)) || String(x.numero).localeCompare(String(y.numero)))
      await route.fulfill({ json: filas })
    },
    async reasignar_gestora(route, a) {
      let n = 0
      for (const id of a.p_tramites as string[]) {
        const t = tramite(id)!
        if (t.gestora_id === a.p_gestora) continue
        registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: t.estado, gestora_antes: t.gestora_id, gestora_despues: a.p_gestora, motivo: a.p_motivo })
        Object.assign(t, { gestora_id: a.p_gestora, version: Number(t.version) + 1 })
        n++
      }
      await route.fulfill({ json: n })
    },
  }

  Object.assign(rpcs, rpcsRendiciones())

  rpcs.marcar_notificaciones_leidas = async (route, a) => {
    const ids = a.p_ids as string[] | null
    let n = 0
    for (const x of notificaciones)
      if (x.perfil_id === yo && !x.leida_at && (!ids || ids.includes(String(x.id)))) {
        x.leida_at = ahora
        n++
      }
    await route.fulfill({ json: n })
  }

  const tablas: Record<string, () => Fila[]> = {
    notificaciones: () => notificaciones.filter((n) => n.perfil_id === yo),
    perfiles: () => perfiles,
    alcances: () => tablaAlcances,
    empresas: () => catalogos.empresas,
    sucursales: () => catalogos.sucursales,
    tipos_tramite: () => catalogos.tipos_tramite,
    operaciones: () => st.operaciones,
    tramites: () => st.tramites.filter(veTramite),
    v_tramite_finanzas: () => st.tramites.filter(veTramite).map(finanzas),
    movimientos: () => st.movimientos.map(({ id, cuenta_id, revierte_id, created_at, fecha_operacion, tipo, tramite_id, importe, es_pago_final }) =>
      ({ id, cuenta_id, revierte_id, created_at, fecha_operacion, tipo, tramite_id, importe, es_pago_final: !!es_pago_final })),
    v_saldos: () => {
      if (rol !== 'gerencia' && rol !== 'contable') return []
      const filas = opciones.saldosFijos ? opciones.saldosFijos(st) : saldos()
      if (!filas) throw new SaldoSinFixture()
      return filas.filter((f) => tieneAlcance(f.empresa_id, null))
    },
    v_movimientos_extracto: extracto,
    eventos: () => st.eventos,
    rendiciones: () => st.rendiciones.filter(veRendicion),
    rendicion_filas: () => st.rendicionFilas.filter((f) => veRendicion(rendicion(f.rendicion_id))),
    comprobantes: () => st.comprobantes.filter((c) => veRendicion(rendicion(c.rendicion_id))),
    comprobante_lineas: () => st.comprobanteLineas.filter((l) =>
      veRendicion(rendicion(st.comprobantes.find((c) => c.id === l.comprobante_id)?.rendicion_id))),
  }

  if (!opciones.sinSesion) await page.addInitScript(
    ([clave, valor]) => window.localStorage.setItem(clave, valor),
    [CLAVE_SESION, JSON.stringify(sesionActiva)] as const,
  )
  // Realtime mínimo (protocolo Phoenix vsn 2.0.0 en frames de texto [join_ref, ref, topic, event,
  // payload]): acepta los joins con postgres_changes y reenvía los movimientos que insertan las RPC.
  await page.routeWebSocket(/\/realtime\/v1\//, (ws) => {
    const socket: Socket = { enviar: (msg) => ws.send(JSON.stringify(msg)), canales: new Map() }
    servidor.sockets.add(socket)
    ws.onClose(() => servidor.sockets.delete(socket))
    let siguienteId = 1
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw)) as [unknown, unknown, string, string, Fila]
      let respuesta: Fila = {}
      if (event === 'phx_join') {
        const filtros = (((payload.config as Fila | undefined)?.postgres_changes ?? []) as Fila[])
          .map((f) => ({ ...f, id: siguienteId++ }))
        socket.canales.set(topic, { joinRef, bindings: filtros.map((f) => ({ id: f.id, table: String(f.table ?? '*') })) })
        respuesta = { postgres_changes: filtros }
      } else if (event === 'phx_leave') socket.canales.delete(topic)
      socket.enviar([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: respuesta }])
    })
  })
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    rutasPedidas.push(url.pathname)
    urlsPedidas.push(decodeURIComponent(url.pathname + url.search))
    if (url.pathname === '/auth/v1/recover') {
      recuperaciones.push({ ...((req.postDataJSON() ?? {}) as Fila), redirect_to: url.searchParams.get('redirect_to') })
      return route.fulfill({ json: {} })
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = (req.postDataJSON() ?? {}) as Fila
      if (b.password !== claveActual)
        return route.fulfill({ status: 400, json: { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' } })
      return route.fulfill({ json: sesionActiva })
    }
    if (url.pathname.startsWith('/auth/v1/user') && req.method() === 'PUT') {
      const b = (req.postDataJSON() ?? {}) as Fila
      if (b.password === claveActual)
        return route.fulfill({ status: 422, json: { code: 'same_password', error_code: 'same_password', msg: 'New password should be different from the old password.' } })
      cambiosClave.push(b)
      if (typeof b.password === 'string') claveActual = b.password
      return route.fulfill({ json: sesionActiva.user })
    }
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: sesionActiva.user })
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' })
    if (url.pathname === '/functions/v1/invitar-usuario') {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' })
      const b = (req.postDataJSON() ?? {}) as Fila
      invitaciones.push(b)
      const responder = (status: number, json: Fila) => route.fulfill({ status, headers: cors, json })
      if (!gestionaUsuarios()) return responder(403, { error: 'SIN_PERMISO: solo administración o gerencia invitan usuarios' })
      const email = String(b.email ?? '')
      if (email === 'repetido@grupoparis.com.ar') return responder(409, { error: 'DUPLICADO: ya existe un usuario con ese email' })
      const id = `00000000-0000-4000-8000-${String(700 + perfiles.length).padStart(12, '0')}`
      perfiles.push({ id, nombre: String(b.nombre), rol: String(b.rol), activo: true })
      reemplazarAlcances(id, b.alcances)
      return responder(200, { id })
    }
    if (url.pathname.startsWith('/storage/v1/')) return storage(route, url)
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)
    if (rpc) {
      const fn = rpcs[rpc[1]]
      if (!fn) throw new Error(`RPC sin mock: ${rpc[1]}`)
      return fn(route, (req.postDataJSON() ?? {}) as Fila)
    }
    const tabla = /^\/rest\/v1\/(\w+)$/.exec(url.pathname)?.[1]
    const fuente = tabla && tablas[tabla]
    if (!fuente || !['GET', 'HEAD'].includes(req.method())) throw new Error(`Ruta sin mock: ${req.method()} ${url.pathname}`)
    let base: Fila[]
    try {
      base = fuente()
    } catch (e) {
      if (e instanceof SaldoSinFixture) return route.fulfill({ status: 500, json: { message: 'estado sin v_saldos registrado' } })
      throw e
    }
    let filas = filtrar(base, url.searchParams)
    if (req.method() === 'HEAD') {
      const total = filas.length
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': total ? `0-${total - 1}/${total}` : `*/0` }, body: '' })
    }
    // Tope de filas de PostgREST (max_rows): una lectura sin paginar se trunca sin error.
    filas = filas.slice(0, MAX_ROWS)
    if (tabla === 'tramites') filas = filas.map(vistaTramite)
    const orden = url.searchParams.get('order')
    if (orden) {
      const claves = orden.split(',').map((o) => o.split('.'))
      const comparar = (x: unknown, y: unknown) =>
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
      filas = [...filas].sort((a, b) => {
        for (const [col, dir] of claves) {
          const c = comparar(a[col], b[col]) * (dir === 'desc' ? -1 : 1)
          if (c) return c
        }
        return 0
      })
    }
    // .range() de supabase-js viaja como offset/limit.
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = url.searchParams.get('limit')
    if (offset || limit) filas = filas.slice(offset, limit ? offset + Number(limit) : undefined)
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
      if (filas.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } })
      return route.fulfill({ json: filas[0] })
    }
    return route.fulfill({ json: filas })
  })
  return { notificaciones, agregarNotificacion, rutasPedidas, urlsPedidas, invitaciones, perfiles, tablaAlcances, recuperaciones, cambiosClave }
}
