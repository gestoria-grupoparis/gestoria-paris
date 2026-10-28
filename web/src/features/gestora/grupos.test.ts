import { describe, expect, it } from 'vitest'
import { grupoDe } from './consultas'

const t = (estado: string, situacion: string, marcas: string[] = []) => ({
  estado, situacion, marcas: marcas.map((marca) => ({ marca })),
})

describe('grupoDe', () => {
  it('sin presupuesto va a Presupuestar aunque esté presentado', () => {
    expect(grupoDe(t('autorizado', 'sin_presupuesto'))).toBe('presupuestar')
    expect(grupoDe(t('presentado', 'sin_presupuesto'))).toBe('presupuestar')
  })
  it('autorizado o en gestoría con presupuesto está listo para presentar', () => {
    expect(grupoDe(t('autorizado', 'comprometido'))).toBe('listos')
    expect(grupoDe(t('en_gestoria', 'sin_fondos'))).toBe('listos')
  })
  it('presentado con presupuesto va a Presentados', () => {
    expect(grupoDe(t('presentado', 'pagado'))).toBe('presentados')
  })
  it('finalizado sin la marca retirado va a Para retirar; con la marca, sale de la lista', () => {
    expect(grupoDe(t('finalizado_registro', 'pagado'))).toBe('retirar')
    expect(grupoDe(t('finalizado_registro', 'pagado', ['retirado']))).toBeNull()
  })
})
