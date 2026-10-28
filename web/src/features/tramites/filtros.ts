// Lógica pura de la pantalla de trámites: filtros <-> querystring, vistas guardadas, estados y fechas.

export interface FiltrosTramites {
  q?: string
  empresa?: string
  sucursal?: string
  provincia?: string
  gestora?: string
  tipo?: string
  estado?: string
  desde?: string
  hasta?: string
  vista?: VistaId
}

export const CLAVES_FILTRO = [
  'q', 'empresa', 'sucursal', 'provincia', 'gestora', 'tipo', 'estado', 'desde', 'hasta', 'vista',
] as const satisfies readonly (keyof FiltrosTramites)[]

// Vistas guardadas de la sección G.1 del spec.
export const VISTAS = [
  { id: 'para_revisar', etiqueta: 'Para revisar' },
  { id: 'autorizados_sin_presentar', etiqueta: 'Autorizados sin presentar' },
  { id: 'sin_fondos', etiqueta: 'Sin fondos' },
  { id: 'demorados', etiqueta: 'Demorados' },
] as const
export type VistaId = (typeof VISTAS)[number]['id']

// "Demorado" (spec, decisión pendiente 8): más de 5 días hábiles autorizado sin presentar, o más de
// 15 presentado sin finalizar.
export const DIAS_DEMORA_AUTORIZADO = 5
export const DIAS_DEMORA_PRESENTADO = 15

export const ESTADOS = [
  { id: 'borrador', etiqueta: 'Borrador', chip: 'bg-slate-100 text-slate-800 ring-slate-300' },
  { id: 'observado', etiqueta: 'Observado', chip: 'bg-amber-100 text-amber-900 ring-amber-300' },
  { id: 'autorizado', etiqueta: 'Autorizado', chip: 'bg-sky-100 text-sky-900 ring-sky-300' },
  { id: 'en_gestoria', etiqueta: 'En gestoría', chip: 'bg-indigo-100 text-indigo-900 ring-indigo-300' },
  { id: 'presentado', etiqueta: 'Presentado', chip: 'bg-violet-100 text-violet-900 ring-violet-300' },
  { id: 'finalizado_registro', etiqueta: 'Finalizado en registro', chip: 'bg-teal-100 text-teal-900 ring-teal-300' },
  { id: 'devuelto', etiqueta: 'Devuelto', chip: 'bg-emerald-100 text-emerald-900 ring-emerald-300' },
  { id: 'cerrado', etiqueta: 'Cerrado', chip: 'bg-emerald-700 text-white ring-emerald-800' },
  { id: 'suspendido', etiqueta: 'Suspendido', chip: 'bg-orange-100 text-orange-900 ring-orange-300' },
  { id: 'cancelado', etiqueta: 'Cancelado', chip: 'bg-zinc-200 text-zinc-600 ring-zinc-300 line-through' },
  { id: 'rechazado', etiqueta: 'Rechazado', chip: 'bg-red-100 text-red-900 ring-red-300' },
] as const

export function etiquetaEstado(estado: string | null | undefined): string {
  return ESTADOS.find((e) => e.id === estado)?.etiqueta ?? (estado ?? '')
}

export const SITUACIONES: Record<string, string> = {
  pagado: 'Pagado',
  sin_fondos: 'Sin fondos',
  comprometido: 'Comprometido',
  sin_presupuesto: 'Sin presupuesto',
  pagado_parcial: 'Pagado parcial',
  no_aplica: '—',
}

export function filtrosDesdeURL(params: URLSearchParams): FiltrosTramites {
  const f: FiltrosTramites = {}
  for (const clave of CLAVES_FILTRO) {
    const v = params.get(clave)?.trim()
    if (!v) continue
    if (clave === 'vista') {
      if (VISTAS.some((x) => x.id === v)) f.vista = v as VistaId
    } else f[clave] = v
  }
  return f
}

/** Devuelve el querystring con los filtros aplicados, conservando parámetros ajenos (p. ej. t). */
export function filtrosAURL(f: FiltrosTramites, actual: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(actual)
  for (const clave of CLAVES_FILTRO) {
    const v = f[clave]?.trim()
    if (v) p.set(clave, v)
    else p.delete(clave)
  }
  return p
}

/** Quita los caracteres que rompen la sintaxis de filtros de PostgREST (or=(...), comodines). */
export function limpiarBusqueda(q: string | undefined): string {
  return (q ?? '').replace(/[,()*\\:"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Fecha operativa (YYYY-MM-DD) en la zona de negocio. */
export function hoyEnBuenosAires(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
}

/** Resta n días hábiles (lunes a viernes; sin feriados) a una fecha YYYY-MM-DD. */
export function restarDiasHabiles(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  let restantes = n
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dia = d.getUTCDay()
    if (dia !== 0 && dia !== 6) restantes--
  }
  return d.toISOString().slice(0, 10)
}

/** Instante de inicio de un día operativo en Buenos Aires (UTC-3, sin horario de verano). */
export function inicioDelDia(fecha: string): string {
  return `${fecha}T00:00:00-03:00`
}

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
})

export function formatearFechaHora(iso: string): string {
  return FORMATO_FECHA_HORA.format(new Date(iso)).replace(',', '')
}

export function formatearFecha(iso: string): string {
  return FORMATO_FECHA.format(new Date(iso))
}
