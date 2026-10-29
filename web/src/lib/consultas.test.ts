import { describe, expect, it, vi } from 'vitest'
import { crearQueryClient, debeReintentar } from './consultas'

describe('debeReintentar', () => {
  it('no reintenta errores de negocio', () => {
    expect(debeReintentar(0, new Error('SIN_PERMISO: x'))).toBe(false)
    expect(debeReintentar(0, { code: 'PGRST301', message: 'JWT expired' })).toBe(false)
  })
  it('reintenta errores de red hasta dos veces', () => {
    expect(debeReintentar(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(debeReintentar(2, new TypeError('Failed to fetch'))).toBe(false)
  })
  it('avisa sesión vencida desde una mutación', async () => {
    const salir = vi.fn()
    const qc = crearQueryClient(salir)
    await qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject({ code: 'PGRST301', message: 'JWT expired' }) }).execute(undefined).catch(() => {})
    expect(salir).toHaveBeenCalledOnce()
    expect(qc.getDefaultOptions().mutations?.retry).toBe(0)
  })
})
