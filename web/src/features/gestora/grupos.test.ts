import { describe, expect, it } from 'vitest'
import { grupoDe } from './consultas'

const t = (estado: string, situacion: string, aprobado = false, marcas: string[] = []) => ({
  estado, situacion, presupuesto_aprobado: aprobado, marcas: marcas.map((marca) => ({ marca })),
})

describe('grupoDe (ping pong con la empresa)', () => {
  it('sin presupuesto va a Presupuestar aunque esté presentado', () => {
    expect(grupoDe(t('autorizado', 'sin_presupuesto'))).toBe('presupuestar')
    expect(grupoDe(t('presentado', 'sin_presupuesto'))).toBe('presupuestar')
  })
  it('con presupuesto sin aprobar espera a la empresa', () => {
    expect(grupoDe(t('autorizado', 'comprometido'))).toBe('aprobacion')
    expect(grupoDe(t('en_gestoria', 'sin_fondos'))).toBe('aprobacion')
  })
  it('aprobado pasa a Retirar y presentar, con o sin el legajo retirado', () => {
    expect(grupoDe(t('autorizado', 'comprometido', true))).toBe('listos')
    expect(grupoDe(t('en_gestoria', 'comprometido', true, ['retirado']))).toBe('listos')
  })
  it('presentado va a Presentados y finalizado a Para devolver', () => {
    expect(grupoDe(t('presentado', 'pagado', true))).toBe('presentados')
    expect(grupoDe(t('finalizado_registro', 'pagado', true, ['retirado']))).toBe('devolver')
  })
  it('devuelto o cerrado ya no es de la gestora', () => {
    expect(grupoDe(t('devuelto', 'pagado', true))).toBeNull()
    expect(grupoDe(t('cerrado', 'pagado', true))).toBeNull()
  })
})
