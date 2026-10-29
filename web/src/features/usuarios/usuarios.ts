import { supabase } from '../../lib/supabase'
import type { Rol } from '../../lib/sesion'

export interface PerfilUsuario {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
}
export interface Alcance {
  perfil_id: string
  empresa_id: string
  sucursal_id: string | null
}
interface Nombrado {
  id: string
  nombre: string
}

export interface AlcanceLegible {
  empresa: string
  detalle: string
}

export interface Usuario extends PerfilUsuario {
  alcances: AlcanceLegible[]
  /** Alcances tal como están en la base (para editarlos). */
  alcancesCrudos: Alcance[]
  /** true si el rol ve todo sin depender de alcances (gestora ve lo asignado; admin no opera). */
  sinAlcances: boolean
}

export const ROLES: { id: Rol; etiqueta: string; descripcion: string }[] = [
  { id: 'gerencia', etiqueta: 'Gerencia', descripcion: 'Autoriza, aprueba excepciones y ve todo su alcance.' },
  { id: 'contable', etiqueta: 'Contable', descripcion: 'Carga trámites, fondos y conciliaciones.' },
  { id: 'gestora', etiqueta: 'Gestora', descripcion: 'Ve y avanza solo los trámites que tiene asignados.' },
  { id: 'comercial', etiqueta: 'Comercial', descripcion: 'Da de alta trámites de sus ventas.' },
  { id: 'admin', etiqueta: 'Administración', descripcion: 'Gestiona usuarios y permisos.' },
]
export const etiquetaRol = (r: string) => ROLES.find((x) => x.id === r)?.etiqueta ?? r

/** Agrupa los alcances por razón social: "toda la empresa" o la lista de sucursales. */
export function alcancesLegibles(propios: Alcance[], empresas: Nombrado[], sucursales: Nombrado[]): AlcanceLegible[] {
  const nombreEmp = new Map(empresas.map((e) => [e.id, e.nombre]))
  const nombreSuc = new Map(sucursales.map((s) => [s.id, s.nombre]))
  const porEmpresa = new Map<string, { entera: boolean; sucursales: string[] }>()
  for (const a of propios) {
    const g = porEmpresa.get(a.empresa_id) ?? { entera: false, sucursales: [] }
    if (a.sucursal_id == null) g.entera = true
    else g.sucursales.push(nombreSuc.get(a.sucursal_id) ?? 'Sucursal desconocida')
    porEmpresa.set(a.empresa_id, g)
  }
  return [...porEmpresa.entries()]
    .map(([id, g]) => ({
      empresa: nombreEmp.get(id) ?? 'Razón social desconocida',
      detalle: g.entera ? 'Todas las sucursales' : g.sucursales.sort((x, y) => x.localeCompare(y, 'es')).join(', '),
    }))
    .sort((x, y) => x.empresa.localeCompare(y.empresa, 'es'))
}

const ORDEN_ROL: Record<string, number> = Object.fromEntries(ROLES.map((r, i) => [r.id, i]))

export function armarUsuarios(perfiles: PerfilUsuario[], alcances: Alcance[], empresas: Nombrado[], sucursales: Nombrado[]): Usuario[] {
  return perfiles
    .map((p) => ({
      ...p,
      alcances: alcancesLegibles(alcances.filter((a) => a.perfil_id === p.id), empresas, sucursales),
      alcancesCrudos: alcances.filter((a) => a.perfil_id === p.id),
      sinAlcances: p.rol === 'gestora' || p.rol === 'admin',
    }))
    .sort((a, b) => Number(b.activo) - Number(a.activo) || (ORDEN_ROL[a.rol] ?? 9) - (ORDEN_ROL[b.rol] ?? 9) || a.nombre.localeCompare(b.nombre, 'es'))
}

export function filtrarUsuarios(lista: Usuario[], texto: string, rol: string): Usuario[] {
  const q = texto.trim().toLocaleLowerCase('es')
  return lista.filter(
    (u) => (!rol || u.rol === rol) && (!q || u.nombre.toLocaleLowerCase('es').includes(q) || u.alcances.some((a) => a.empresa.toLocaleLowerCase('es').includes(q))),
  )
}

export interface CatalogoAlcance {
  empresas: Nombrado[]
  sucursales: Nombrado[]
}

export async function cargarUsuarios(): Promise<Usuario[]> {
  return (await cargarUsuariosYCatalogo()).usuarios
}

export async function cargarUsuariosYCatalogo(): Promise<{ usuarios: Usuario[] } & CatalogoAlcance> {
  const [p, a, e, s] = await Promise.all([
    supabase.from('perfiles').select('id,nombre,rol,activo').order('nombre'),
    supabase.from('alcances').select('perfil_id,empresa_id,sucursal_id'),
    supabase.from('empresas').select('id,nombre').order('nombre'),
    supabase.from('sucursales').select('id,nombre').order('nombre'),
  ])
  for (const r of [p, a, e, s]) if (r.error) throw r.error
  const empresas = e.data ?? []
  const sucursales = s.data ?? []
  return { usuarios: armarUsuarios((p.data ?? []) as PerfilUsuario[], (a.data ?? []) as Alcance[], empresas, sucursales), empresas, sucursales }
}

// --- Gestión (admin y gerencia) ---------------------------------------------------------------

/** Alcance elegido por razón social: toda la empresa o una lista de sucursales. */
export type Seleccion = Record<string, { todas: boolean; sucursales: string[] }>

export function seleccionDesdeAlcances(alcances: Alcance[]): Seleccion {
  const sel: Seleccion = {}
  for (const a of alcances) {
    const g = (sel[a.empresa_id] ??= { todas: false, sucursales: [] })
    if (a.sucursal_id == null) g.todas = true
    else g.sucursales.push(a.sucursal_id)
  }
  for (const g of Object.values(sel)) if (g.todas) g.sucursales = []
  return sel
}

export function alcancesDesdeSeleccion(sel: Seleccion): { empresa_id: string; sucursal_id: string | null }[] {
  return Object.entries(sel).flatMap(([empresa_id, g]) =>
    g.todas ? [{ empresa_id, sucursal_id: null as string | null }] : g.sucursales.map((sucursal_id): { empresa_id: string; sucursal_id: string | null } => ({ empresa_id, sucursal_id })),
  )
}

/** Roles cuyo acceso depende de las razones sociales asignadas. */
export const ROLES_CON_ALCANCE: Rol[] = ['gerencia', 'contable', 'comercial']

export interface DatosUsuario {
  email?: string
  nombre: string
  rol: Rol
  seleccion: Seleccion
}

export function validarUsuario(d: DatosUsuario, modo: 'alta' | 'edicion'): string | null {
  if (modo === 'alta' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.email ?? '').trim())) return 'Ingresá un email válido.'
  if (!d.nombre.trim()) return 'Ingresá el nombre y apellido.'
  if (ROLES_CON_ALCANCE.includes(d.rol) && alcancesDesdeSeleccion(d.seleccion).length === 0)
    return 'Elegí al menos una razón social (o sucursal) para este rol.'
  return null
}

export function rolesAsignables(miRol: Rol | null) {
  return miRol === 'admin' ? ROLES : miRol === 'gerencia' ? ROLES.filter((r) => r.id !== 'admin') : []
}

export function puedeGestionar(miRol: Rol | null, _miId: string | undefined, u: Pick<Usuario, 'id' | 'rol'>): boolean {
  if (miRol === 'admin') return true
  return miRol === 'gerencia' && u.rol !== 'admin'
}

export function puedeCambiarEstado(miRol: Rol | null, miId: string | undefined, u: Pick<Usuario, 'id' | 'rol'>): boolean {
  return u.id !== miId && puedeGestionar(miRol, miId, u)
}

/** supabase.functions.invoke deja el cuerpo de error en error.context (Response). */
export async function errorDeFuncion(e: unknown): Promise<Error> {
  const ctx = e && typeof e === 'object' && 'context' in e ? (e as { context: unknown }).context : null
  if (ctx instanceof Response) {
    try {
      const cuerpo = (await ctx.json()) as { error?: unknown }
      if (typeof cuerpo.error === 'string') return new Error(cuerpo.error)
    } catch {
      /* cuerpo no JSON */
    }
  }
  return e instanceof Error ? e : new Error(String(e))
}

export async function invitarUsuario(d: DatosUsuario): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ id: string }>('invitar-usuario', {
    body: { email: d.email!.trim().toLowerCase(), nombre: d.nombre.trim(), rol: d.rol, alcances: alcancesDesdeSeleccion(d.seleccion) },
  })
  if (error) throw await errorDeFuncion(error)
  return data!.id
}

export async function editarUsuario(id: string, d: DatosUsuario, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('editar_usuario', {
    p_perfil: id,
    p_nombre: d.nombre.trim(),
    p_rol: d.rol,
    p_alcances: alcancesDesdeSeleccion(d.seleccion),
    p_motivo: motivo.trim(),
  })
  if (error) throw error
}

export async function cambiarActivoUsuario(id: string, activo: boolean, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('cambiar_activo_usuario', { p_perfil: id, p_activo: activo, p_motivo: motivo.trim() })
  if (error) throw error
}
