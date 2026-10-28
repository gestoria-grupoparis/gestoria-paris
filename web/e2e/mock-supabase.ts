// Simula la API HTTP de Supabase (auth + PostgREST + RPC) para los E2E. No hay usuarios de prueba en
// staging y no se pueden crear, así que el navegador nunca sale de este mock: las RPC replican la
// parte de las reglas de negocio que ejercitan los specs (duplicados, versión, motivo obligatorio).
import type { Page, Route } from '@playwright/test'
import sesion from './fixtures/sesion.json' with { type: 'json' }
import catalogos from './fixtures/catalogos.json' with { type: 'json' }

export const SUPABASE_URL = 'http://supabase.e2e.test'
const CLAVE_SESION = 'sb-supabase-auth-token'

type Fila = Record<string, unknown>

interface Estado {
  operaciones: Fila[]
  tramites: Fila[]
  marcas: Fila[]
  eventos: Fila[]
  siguienteEvento: number
}

export interface Semilla {
  operacion: Fila
  tramite: Fila
}

const nombreDe = (lista: Fila[], id: unknown) => lista.find((x) => x.id === id)

function errorNegocio(route: Route, message: string) {
  return route.fulfill({ status: 400, json: { code: 'P0001', message, details: null, hint: null } })
}

// --- Filtros PostgREST mínimos: eq, neq, in, gte, lt, lte, ilike, is, or=(...), and(...) ---------
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

// --- Mock --------------------------------------------------------------------------------------
export async function montarSupabase(page: Page, semillas: Semilla[] = []) {
  const ahora = catalogos.ahora
  const yo = sesion.user.id
  const st: Estado = {
    operaciones: semillas.map((s) => ({ ...s.operacion })),
    tramites: semillas.map((s) => ({ ...s.tramite })),
    marcas: [],
    eventos: [],
    siguienteEvento: 1,
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
      presupuestos: [],
    }
  }

  function finanzas(t: Fila): Fila {
    return { tramite_id: t.id, presupuesto: null, pagado: '0', situacion: 'no_aplica' }
  }

  function tramite(id: unknown) {
    return st.tramites.find((t) => t.id === id)
  }

  const rpcs: Record<string, (route: Route, a: Fila) => Promise<void>> = {
    async crear_tramite(route, a) {
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
    perfiles: () => catalogos.perfiles,
    empresas: () => catalogos.empresas,
    sucursales: () => catalogos.sucursales,
    tipos_tramite: () => catalogos.tipos_tramite,
    operaciones: () => st.operaciones,
    tramites: () => st.tramites,
    v_tramite_finanzas: () => st.tramites.map(finanzas),
    movimientos: () => [],
    eventos: () => st.eventos,
  }

  await page.addInitScript(
    ([clave, valor]) => window.localStorage.setItem(clave, valor),
    [CLAVE_SESION, JSON.stringify(sesion)] as const,
  )
  await page.routeWebSocket(/\/realtime\/v1\//, () => {
    // Acepta la conexión de Realtime sin servidor detrás: los specs no dependen de eventos en vivo.
  })
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: sesion.user })
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' })
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)
    if (rpc) {
      const fn = rpcs[rpc[1]]
      if (!fn) throw new Error(`RPC sin mock: ${rpc[1]}`)
      return fn(route, (req.postDataJSON() ?? {}) as Fila)
    }
    const tabla = /^\/rest\/v1\/(\w+)$/.exec(url.pathname)?.[1]
    const fuente = tabla && tablas[tabla]
    if (!fuente || req.method() !== 'GET') throw new Error(`Ruta sin mock: ${req.method()} ${url.pathname}`)
    let filas = filtrar(fuente(), url.searchParams)
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
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
      if (filas.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } })
      return route.fulfill({ json: filas[0] })
    }
    return route.fulfill({ json: filas })
  })
}
