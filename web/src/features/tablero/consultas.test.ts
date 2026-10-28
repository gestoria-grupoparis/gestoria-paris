import { beforeEach, describe, expect, it, vi } from 'vitest'

const llamadas: { select: [string, unknown]; estado?: string }[] = []
const conteos: Record<string, number> = { borrador: 1500, presentado: 3, cerrado: 2400 }

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (tabla: string) => {
      expect(tabla).toBe('tramites')
      return {
        select: (cols: string, opts: unknown) => {
          const llamada: (typeof llamadas)[number] = { select: [cols, opts] }
          llamadas.push(llamada)
          return {
            eq: async (col: string, valor: string) => {
              expect(col).toBe('estado')
              llamada.estado = valor
              return { data: null, count: conteos[valor] ?? 0, error: null }
            },
          }
        },
      }
    },
  },
}))

import { contarPorEstado } from './consultas'
import { ESTADOS } from '../tramites/filtros'

describe('contarPorEstado', () => {
  beforeEach(() => { llamadas.length = 0 })

  it('pide un conteo exacto sin filas por cada estado (no lo trunca max_rows)', async () => {
    const cuenta = await contarPorEstado()
    expect(llamadas).toHaveLength(ESTADOS.length)
    for (const l of llamadas) expect(l.select[1]).toEqual({ count: 'exact', head: true })
    expect(llamadas.map((l) => l.estado).sort()).toEqual(ESTADOS.map((e) => e.id).sort())
    expect(cuenta.borrador).toBe(1500)
    expect(cuenta.cerrado).toBe(2400)
    expect(cuenta.presentado).toBe(3)
    expect(cuenta.observado).toBe(0)
  })
})
