import { describe, expect, it } from 'vitest'
import { DOMINIO_VALIDO, inicial, validarAlta } from './FormAlta'

describe('validarAlta', () => {
  it('marca los obligatorios y el formato de dominio', () => {
    const vacio = { empresa: '', sucursal: '', tipo: '', cliente: '', cuentaPersonal: '', oferta: '', vehiculo: '', dominio: 'X1', chasis: '' }
    const e = validarAlta(vacio)
    expect(Object.keys(e)).toEqual(['empresa', 'sucursal', 'tipo', 'oferta', 'cliente', 'cuentaPersonal', 'vehiculo', 'dominio'])
    expect(DOMINIO_VALIDO.test('AB123CD')).toBe(true)
    expect(DOMINIO_VALIDO.test('ABC123')).toBe(true)
    expect(DOMINIO_VALIDO.test('AB12CD')).toBe(false)
  })
})

describe('inicial', () => {
  const cat = {
    empresas: [{ id: 'e1', nombre: 'A' }, { id: 'e2', nombre: 'B' }],
    sucursales: [{ id: 's1', nombre: 'S', provincia: 'SL' }, { id: 's2', nombre: 'T', provincia: 'SJ' }],
    tipos: [{ id: 't1', codigo: 'patentamiento_0km', nombre: 'Patentamiento' }],
  } as never
  it('recuerda razón social, sucursal y tipo del último alta', () => {
    const mem = new Map<string, string>()
    globalThis.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as Storage
    expect(inicial(cat).tipo).toBe('')
    mem.set('alta-ultima-empresa-sucursal', JSON.stringify({ empresa: 'e2', sucursal: 's1', tipo: 'patentamiento_0km' }))
    const d = inicial(cat)
    expect([d.empresa, d.sucursal, d.tipo]).toEqual(['e2', 's1', 'patentamiento_0km'])
  })
})
