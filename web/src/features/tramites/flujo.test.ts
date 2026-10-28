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
