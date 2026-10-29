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
  /** importe con signo en centavos (texto), como movimientos.importe_cents. */
  movimientos: Fila[]
  /** { cuenta_id, fecha_corte, diferencia, movimientos: id[] } */
  conciliaciones: Fila[]
  siguienteEvento: number
}

export interface Semilla {
  operacion: Fila
  tramite: Fila
  /** Totales en centavos (texto) de las versiones del presupuesto, de la 1 en adelante. */
  presupuestos?: string[]
  /** Fuerza la situación financiera (p. ej. sin_fondos, que depende del saldo de la cuenta). */
  situacion?: string
}

export interface Extra {
  movimientos?: Fila[]
  conciliaciones?: Fila[]
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
  perfilesExtra?: { id: string; nombre: string; rol: string; activo: boolean }[]
  /**
   * Fuente fija de v_saldos (salida real de la base, p. ej. fixtures/escenario-saldos.json). Recibe el
   * estado y devuelve las filas, o undefined si el estado no tiene salida registrada: en ese caso la
   * consulta responde 500 y el test falla en lugar de mostrar un saldo calculado por el mock.
   */
  saldosFijos?: (st: Estado) => Fila[] | undefined
  /** Arranca sin sesión guardada (pantalla de ingreso, link de recuperación vencido). */
  sinSesion?: boolean
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
      marcas: [],
      eventos: [],
      presupuestos: semillas.flatMap((s) =>
        (s.presupuestos ?? []).map((total, i) => ({ tramite_id: s.tramite.id, version: i + 1, total }))),
      movimientos: (extra.movimientos ?? []).map((m) => ({ ...m })),
      conciliaciones: (extra.conciliaciones ?? []).map((c) => ({ ...c })),
      siguienteEvento: 1,
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
  const { st, situacionForzada } = servidor

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
    return {
      tramite_id: t.id, empresa_id: t.empresa_id, presupuesto, pagado: String(pagado),
      comprometido: String(comprometido), comprometido_cents: String(comprometido), situacion,
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
  const rpcs: Record<string, (route: Route, a: Fila) => Promise<void>> = {
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
      registrarEvento({ entidad: 'tramites', entidad_id: t.id, accion: 'update', estado_antes: t.estado, estado_despues: a.p_estado, motivo })
      Object.assign(t, { estado: a.p_estado, version: Number(t.version) + 1 })
      await route.fulfill({ status: 204, body: '' })
    },
    async marcar(route, a) {
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

  const tablas: Record<string, () => Fila[]> = {
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
  return { rutasPedidas, urlsPedidas, invitaciones, perfiles, tablaAlcances, recuperaciones, cambiosClave }
}
