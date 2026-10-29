// Vinculación de filas de la planilla con trámites y de comprobantes con filas.
// Nunca adivina: ante dos candidatos posibles queda "ambiguo" (o sin asignar) para revisión.

import type { Extraido } from './parsers'
import { normalizarDocumento, normalizarNombre } from './normalizar'

export interface Candidato {
  id: string
  numero: string
  cliente: string
  dominio: string | null
  autorizado: boolean
}

export interface Vinculo {
  vinculo: 'auto' | 'ambiguo' | 'sin_vincular'
  tramite_id: string | null
  candidatos: string[]
}

const dom = (d: string | null | undefined) => (d ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null

/** Coincidencia por nombre: exacta; si no hay ninguna, todas las palabras de la fila en el otro nombre. */
function porNombre<T>(nombre: string, items: T[], nombreDe: (t: T) => string): T[] {
  const n = normalizarNombre(nombre)
  if (!n) return []
  const exactos = items.filter((i) => normalizarNombre(nombreDe(i)) === n)
  if (exactos.length) return exactos
  const palabras = n.split(' ')
  return items.filter((i) => {
    const otras = new Set(normalizarNombre(nombreDe(i)).split(' '))
    return palabras.every((p) => otras.has(p))
  })
}

function resultado(ids: string[]): Vinculo {
  if (ids.length === 1) return { vinculo: 'auto', tramite_id: ids[0], candidatos: ids }
  if (ids.length > 1) return { vinculo: 'ambiguo', tramite_id: null, candidatos: ids }
  return { vinculo: 'sin_vincular', tramite_id: null, candidatos: [] }
}

export function vincularFila(f: { nombre: string; dominio: string | null }, candidatos: Candidato[]): Vinculo {
  const d = dom(f.dominio)
  if (d) {
    const porDominio = candidatos.filter((c) => dom(c.dominio) === d)
    if (porDominio.length) return resultado(porDominio.map((c) => c.id))
  }
  return resultado(porNombre(f.nombre, candidatos, (c) => c.cliente).map((c) => c.id))
}

export interface FilaAsignable {
  id: string
  nombre: string
  dominio: string | null
  /** DNI ya conocido de esa fila (de otro comprobante confirmado), si lo hay. */
  documento?: string | null
}

/** Fila a la que corresponde un comprobante: por dominio, después DNI y después nombre. */
export function asignarComprobante(c: Extraido, filas: FilaAsignable[]): string | null {
  const unico = (xs: FilaAsignable[]) => (xs.length === 1 ? xs[0].id : null)
  const d = dom(c.dominio)
  if (d) {
    const xs = filas.filter((f) => dom(f.dominio) === d)
    if (xs.length) return unico(xs)
  }
  const doc = c.documento ? normalizarDocumento(c.documento) : null
  if (doc) {
    const xs = filas.filter((f) => f.documento && normalizarDocumento(f.documento) === doc)
    if (xs.length) return unico(xs)
  }
  if (c.nombre) return unico(porNombre(c.nombre, filas, (f) => f.nombre))
  return null
}
