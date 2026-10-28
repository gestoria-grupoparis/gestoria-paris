import type { Rol } from '../lib/sesion'

export interface ItemNav {
  ruta: string
  etiqueta: string
}

const TABLERO = { ruta: '/tablero', etiqueta: 'Tablero' }
const TRAMITES = { ruta: '/tramites', etiqueta: 'Trámites' }
const HABITUALISTA = { ruta: '/habitualista', etiqueta: 'Habitualista' }
const MIS_TRAMITES = { ruta: '/mis-tramites', etiqueta: 'Mis trámites' }

export function navegacionPorRol(rol: Rol | null): ItemNav[] {
  switch (rol) {
    case 'gerencia':
      return [TABLERO, TRAMITES, HABITUALISTA]
    case 'contable':
      return [TRAMITES, HABITUALISTA, TABLERO]
    case 'gestora':
      return [MIS_TRAMITES]
    default:
      return []
  }
}
