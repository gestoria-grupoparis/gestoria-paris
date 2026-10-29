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
const RENDICIONES = { ruta: '/rendiciones', etiqueta: 'Rendiciones' }
const MIS_TRAMITES = { ruta: '/mis-tramites', etiqueta: 'Mis trámites' }

export function navegacionPorRol(rol: Rol | null): ItemNav[] {
  switch (rol) {
    case 'gerencia':
      return [TABLERO, TRAMITES, HABITUALISTA, INFORMES, RENDICIONES, USUARIOS]
    case 'contable':
      return [TRAMITES, HABITUALISTA, INFORMES, RENDICIONES, TABLERO]
    case 'gestora':
      return [MIS_TRAMITES]
    case 'admin':
      return [USUARIOS]
    default:
      return []
  }
}
