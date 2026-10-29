import { describe, expect, test, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { centavos, controles, mapearComprobante, mapearControles, mapearFila } from './consultas'

const CRUDO = {
  importes: {
    filas: [{ fila_id: 'f1', nombre: 'PEREZ', pago_cents: '116385524', comprobantes_cents: '116385624', diferencia_cents: '100', ok: false }],
    total_planilla_cents: '116385524', debitado_habitualista_cents: '116385524', diferencia_cents: '0',
    movimientos_sin_rendir: [{ movimiento_id: 'm1', fecha: '2026-07-15', importe_cents: '1234500', tramite_id: 't', tramite_numero: 'T-2026-00003' }],
    ok: false,
  },
  autorizados: { filas_no_autorizadas: [], ok: true },
  honorarios: { cantidad_tramites: 1, honorario_unitario_cents: '3250000', esperado_cents: '3250000', facturado_cents: '0', diferencia_cents: '-3250000', ok: false },
}

describe('mapeo de importes', () => {
  test('los centavos quedan como string, nunca number', async () => {
    rpc.mockResolvedValueOnce({ data: CRUDO, error: null })
    const c = await controles('r1')
    expect(rpc).toHaveBeenCalledWith('controles_rendicion', { p_rendicion: 'r1' })
    expect(c.importes.filas[0].diferencia_cents).toBe('100')
    expect(typeof c.importes.total_planilla_cents).toBe('string')
    expect(c.importes.movimientos_sin_rendir[0].importe_cents).toBe('1234500')
    expect(c.honorarios.diferencia_cents).toBe('-3250000')
  })

  test('un number seguro se convierte a texto; uno inseguro se rechaza', () => {
    expect(centavos(3250000)).toBe('3250000')
    expect(centavos(-529000n)).toBe('-529000')
    expect(() => centavos(2 ** 60)).toThrow()
    expect(() => centavos('12,5')).toThrow()
    const c = mapearControles({ ...CRUDO, honorarios: { ...CRUDO.honorarios, esperado_cents: 3250000 } })
    expect(c.honorarios.esperado_cents).toBe('3250000')
  })

  test('filas y comprobantes', () => {
    expect(mapearFila({ id: 'f', orden: 1, nombre: 'X', pago: '10', honorarios: 5, vinculo: 'auto', candidatos: ['t'] }))
      .toMatchObject({ pago: '10', honorarios: '5', dominio: null, tramite_id: null })
    const c = mapearComprobante({ id: 'c', tipo: 'otro', total: null, pagina: 1 }, [{ concepto: 'Bonif', importe: '-529000' }])
    expect(c).toMatchObject({ total: null, lineas: [{ concepto: 'Bonif', importe: '-529000' }], revision: 'pendiente' })
  })
})
