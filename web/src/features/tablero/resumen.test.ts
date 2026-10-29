import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { listarIntervencion, resumenTablero, sumar } from './consultas'

describe('resumen del tablero', () => {
  it('pide el resumen y la intervención en una sola llamada cada uno, con el corte de demora', async () => {
    rpc.mockResolvedValue({ data: [{ empresa_id: 'a', empresa: 'Doral', por_aprobar: 2, abiertos: 3 }], error: null })
    const filas = await resumenTablero()
    expect(rpc).toHaveBeenCalledWith('resumen_tablero', { p_corte: expect.any(String) })
    expect(sumar(filas, 'por_aprobar')).toBe(2)
    rpc.mockResolvedValue({ data: [], error: null })
    await listarIntervencion()
    expect(rpc).toHaveBeenLastCalledWith('tramites_intervencion', { p_corte: expect.any(String) })
  })
  it('propaga el error', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('SIN_PERMISO: x') })
    await expect(resumenTablero()).rejects.toThrow('SIN_PERMISO')
  })
})
