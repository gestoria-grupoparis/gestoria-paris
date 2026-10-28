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

export async function cargarUsuarios(): Promise<Usuario[]> {
  const [p, a, e, s] = await Promise.all([
    supabase.from('perfiles').select('id,nombre,rol,activo').order('nombre'),
    supabase.from('alcances').select('perfil_id,empresa_id,sucursal_id'),
    supabase.from('empresas').select('id,nombre').order('nombre'),
    supabase.from('sucursales').select('id,nombre').order('nombre'),
  ])
  for (const r of [p, a, e, s]) if (r.error) throw r.error
  return armarUsuarios((p.data ?? []) as PerfilUsuario[], (a.data ?? []) as Alcance[], e.data ?? [], s.data ?? [])
}
