import { describe, expect, it } from 'vitest'
import { destinoNotificacion, haceCuanto, noLeidas, TIPO_NOTIFICACION } from './formato'

describe('notificaciones', () => {
  const ahora = new Date('2026-10-29T12:00:00Z')
  it('haceCuanto en rioplatense', () => {
    expect(haceCuanto('2026-10-29T11:59:40Z', ahora)).toBe('recién')
    expect(haceCuanto('2026-10-29T11:55:00Z', ahora)).toBe('hace 5 min')
    expect(haceCuanto('2026-10-29T09:00:00Z', ahora)).toBe('hace 3 h')
    expect(haceCuanto('2026-10-28T09:00:00Z', ahora)).toBe('ayer')
    expect(haceCuanto('2026-10-20T09:00:00Z', ahora)).toBe('hace 9 días')
  })
  it('destino: la gestora va a Mis trámites; el resto abre el panel del trámite', () => {
    expect(destinoNotificacion('gestora', 'abc')).toBe('/mis-tramites')
    expect(destinoNotificacion('gerencia', 'abc')).toBe('/tramites?t=abc')
    expect(destinoNotificacion('contable', null)).toBeNull()
  })
  it('cuenta no leídas y etiqueta cada tipo', () => {
    expect(noLeidas([{ leida_at: null }, { leida_at: 'x' }, { leida_at: null }])).toBe(2)
    expect(TIPO_NOTIFICACION.sin_fondos.etiqueta).toBe('Sin fondos')
    expect(Object.keys(TIPO_NOTIFICACION).sort()).toEqual(['asignado', 'observado', 'presupuesto_aprobado', 'presupuesto_cargado', 'sin_fondos'])
  })
})
