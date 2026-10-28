import { expect, it } from 'vitest'
import { navegacionPorRol } from './navegacion'

it('ordena la navegación según el rol', () => {
  const et = (r: Parameters<typeof navegacionPorRol>[0]) => navegacionPorRol(r).map((i) => i.etiqueta)
  expect(et('gerencia')).toEqual(['Tablero', 'Trámites', 'Habitualista'])
  expect(et('contable')).toEqual(['Trámites', 'Habitualista', 'Tablero'])
  expect(et('gestora')).toEqual(['Mis trámites'])
  expect(et(null)).toEqual([])
})
