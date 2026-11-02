import type { Rol } from '../lib/sesion'

export interface ItemNav {
  ruta: string
  etiqueta: string
}

const TABLERO = { ruta: '/tablero', etiqueta: 'Tablero' }
const TRAMITES = { ruta: '/tramites', etiqueta: 'Trámites' }
const HABITUALISTA = { ruta: '/habitualista', etiqueta: 'Habitualista' }
const INFORMES = { ruta: '/informes', etiqueta: 'Informes' }
const USUARIOS = { ruta: '/usuarios', etiqueta: 'Usuarios' }
const ANALISIS = { ruta: '/analisis', etiqueta: 'Análisis' }
const RENDICIONES = { ruta: '/rendiciones', etiqueta: 'Rendiciones' }
const MIS_TRAMITES = { ruta: '/mis-tramites', etiqueta: 'Mis trámites' }

export function navegacionPorRol(rol: Rol | null): ItemNav[] {
  switch (rol) {
    case 'gerencia':
      return [TABLERO, TRAMITES, HABITUALISTA, INFORMES, ANALISIS, RENDICIONES, USUARIOS]
    case 'contable':
      return [TABLERO, TRAMITES, HABITUALISTA, INFORMES, ANALISIS, RENDICIONES]
    case 'gestora':
      return [MIS_TRAMITES]
    case 'admin':
      return [USUARIOS]
    default:
      return []
  }
}

/** Pantalla de inicio de cada rol (el menú tiene el mismo orden para todos; el inicio no siempre es el primero). */
export function inicioPorRol(rol: Rol | null): string | undefined {
  if (rol === 'contable') return TRAMITES.ruta
  return navegacionPorRol(rol)[0]?.ruta
}

/** Accesos fijos de la barra inferior del celular: hasta 4 + "Más" cuando no entran todos (máximo 5). */
export const MAX_BARRA_MOVIL = 5
export function partirBarraMovil(items: ItemNav[]): { fijos: ItemNav[]; mas: ItemNav[] } {
  if (items.length <= MAX_BARRA_MOVIL) return { fijos: items, mas: [] }
  return { fijos: items.slice(0, MAX_BARRA_MOVIL - 1), mas: items.slice(MAX_BARRA_MOVIL - 1) }
}
