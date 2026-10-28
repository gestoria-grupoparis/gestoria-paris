import { describe, expect, it } from 'vitest'
import { conciliacionVencida, DIAS_CONCILIACION, necesidadRecarga } from './saldos'

describe('necesidadRecarga = max(-disponible, 0) sobre el texto en centavos', () => {
  it('disponible negativo: recarga por el faltante', () => expect(necesidadRecarga('-12345600')).toBe('12345600'))
  it('disponible positivo o cero: no hace falta recargar', () => {
    expect(necesidadRecarga('80000000')).toBe('0')
    expect(necesidadRecarga('0')).toBe('0')
  })
  it('rechaza lo que no es un entero', () => expect(() => necesidadRecarga('1.5')).toThrow())
})

describe('conciliacionVencida', () => {
  const hoy = '2026-10-28'
  it('sin conciliaciones está vencida', () => expect(conciliacionVencida(null, null, hoy)).toBe(true))
  it('dentro de los 7 días y sin diferencia está al día', () => {
    expect(DIAS_CONCILIACION).toBe(7)
    expect(conciliacionVencida('2026-10-21', '0', hoy)).toBe(false)
  })
  it('más de 7 días es vieja', () => expect(conciliacionVencida('2026-10-20', '0', hoy)).toBe(true))
  it('con diferencia distinta de cero', () => expect(conciliacionVencida('2026-10-27', '-100', hoy)).toBe(true))
})
