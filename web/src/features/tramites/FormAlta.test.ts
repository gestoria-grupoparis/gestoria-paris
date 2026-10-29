import { describe, expect, it } from 'vitest'
import { DOMINIO_VALIDO, validarAlta } from './FormAlta'

describe('validarAlta', () => {
  it('marca los obligatorios y el formato de dominio', () => {
    const vacio = { empresa: '', sucursal: '', tipo: '', cliente: '', cuentaPersonal: '', oferta: '', vehiculo: '', dominio: 'X1', chasis: '' }
    const e = validarAlta(vacio)
    expect(Object.keys(e)).toEqual(['cliente', 'cuentaPersonal', 'empresa', 'sucursal', 'oferta', 'tipo', 'vehiculo', 'dominio'])
    expect(DOMINIO_VALIDO.test('AB123CD')).toBe(true)
    expect(DOMINIO_VALIDO.test('ABC123')).toBe(true)
    expect(DOMINIO_VALIDO.test('AB12CD')).toBe(false)
  })
})
