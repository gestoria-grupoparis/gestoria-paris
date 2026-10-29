import { expect, it } from 'vitest'
import { navegacionPorRol } from './navegacion'

it('ordena la navegación según el rol', () => {
  const et = (r: Parameters<typeof navegacionPorRol>[0]) => navegacionPorRol(r).map((i) => i.etiqueta)
  expect(et('gerencia')).toEqual(['Tablero', 'Trámites', 'Habitualista', 'Informes', 'Análisis', 'Rendiciones', 'Usuarios'])
  expect(et('admin')).toEqual(['Usuarios'])
  expect(et('contable')).toEqual(['Trámites', 'Habitualista', 'Informes', 'Análisis', 'Rendiciones', 'Tablero'])
  expect(et('gestora')).toEqual(['Mis trámites'])
  expect(et(null)).toEqual([])
})
