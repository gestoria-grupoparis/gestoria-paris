import { describe, expect, it } from 'vitest'
import type { Evento } from './consultas'
import { AVANCE, estadoPrevioSuspension, indicePaso, puedeCancelar, puedeRechazar, puedeSuspender } from './flujo'

const ev = (id: number, antes: string, despues: string): Evento => ({
  id, at: '2026-10-28T13:00:00Z', actor_id: null, entidad: 'tramites', accion: 'update',
  estado_antes: antes, estado_despues: despues, gestora_antes: null, gestora_despues: null, marca: null, motivo: 'x',
})

describe('flujo del trámite', () => {
  it('ubica cada estado en el recorrido', () => {
    expect(indicePaso('borrador')).toBe(0)
    expect(indicePaso('observado')).toBe(0)
    expect(indicePaso('en_gestoria')).toBe(1)
    expect(indicePaso('cerrado')).toBe(5)
    expect(indicePaso('cancelado')).toBe(-1)
  })
  it('respeta la tabla de transiciones de la oficina', () => {
    expect(puedeRechazar('borrador')).toBe(true)
    expect(puedeRechazar('autorizado')).toBe(false)
    expect(puedeSuspender('presentado')).toBe(true)
    expect(puedeSuspender('suspendido')).toBe(false)
    expect(puedeCancelar('cerrado')).toBe(false)
    expect(puedeCancelar('suspendido')).toBe(true)
    expect(AVANCE.devuelto.hacia).toBe('cerrado')
    expect(AVANCE.borrador).toBeUndefined()
  })
  it('reanuda al estado previo a la última suspensión', () => {
    expect(estadoPrevioSuspension([ev(3, 'presentado', 'suspendido'), ev(2, 'autorizado', 'presentado'), ev(1, 'borrador', 'suspendido')])).toBe('presentado')
    expect(estadoPrevioSuspension([])).toBeNull()
  })
})

describe('acciones de edición y dinero desde el panel', () => {
  it('solo se editan borradores y observados', async () => {
    const { puedeEditar } = await import('./flujo')
    expect(puedeEditar('borrador')).toBe(true)
    expect(puedeEditar('observado')).toBe(true)
    expect(puedeEditar('autorizado')).toBe(false)
    expect(puedeEditar('cancelado')).toBe(false)
  })
  it('presupuesto solo en autorizado, en gestoría o presentado', async () => {
    const { puedePresupuestar } = await import('./flujo')
    expect(['autorizado', 'en_gestoria', 'presentado'].every(puedePresupuestar)).toBe(true)
    expect(puedePresupuestar('borrador')).toBe(false)
    expect(puedePresupuestar('finalizado_registro')).toBe(false)
  })
  it('un pago fuera de curso es una excepción R24 que exige motivo', async () => {
    const { pagoEsExcepcion } = await import('./flujo')
    expect(pagoEsExcepcion('autorizado')).toBe(false)
    expect(pagoEsExcepcion('finalizado_registro')).toBe(false)
    expect(pagoEsExcepcion('borrador')).toBe(true)
    expect(pagoEsExcepcion('cancelado')).toBe(true)
  })
  it('la excepción de fondos la aprueba gerencia sobre un trámite sin fondos', async () => {
    const { puedeAprobarExcepcion } = await import('./flujo')
    expect(puedeAprobarExcepcion('gerencia', 'sin_fondos')).toBe(true)
    expect(puedeAprobarExcepcion('contable', 'sin_fondos')).toBe(false)
    expect(puedeAprobarExcepcion('gerencia', 'comprometido')).toBe(false)
  })
  it('nombra cada movimiento del trámite', async () => {
    const { etiquetaMovimiento } = await import('./flujo')
    expect(etiquetaMovimiento('pago_tramite', true)).toBe('Pago final')
    expect(etiquetaMovimiento('pago_tramite', false)).toBe('Pago')
    expect(etiquetaMovimiento('reintegro', false)).toBe('Reintegro')
    expect(etiquetaMovimiento('reversion', false)).toBe('Reversión')
  })
})

describe('selección de filas para reasignar en lote', () => {
  it('alterna una fila y todas las visibles', async () => {
    const { alternar, alternarTodas } = await import('./flujo')
    let s = alternar(new Set<string>(), 'a')
    expect([...s]).toEqual(['a'])
    s = alternar(s, 'a')
    expect(s.size).toBe(0)
    s = alternarTodas(new Set(['a']), ['a', 'b', 'c'])
    expect([...s].sort()).toEqual(['a', 'b', 'c'])
    s = alternarTodas(s, ['a', 'b', 'c'])
    expect(s.size).toBe(0)
  })
})
