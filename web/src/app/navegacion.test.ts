import { expect, it } from 'vitest'
import { inicioPorRol, navegacionPorRol, partirBarraMovil } from './navegacion'

it('ordena la navegación según el rol', () => {
  const et = (r: Parameters<typeof navegacionPorRol>[0]) => navegacionPorRol(r).map((i) => i.etiqueta)
  expect(et('gerencia')).toEqual(['Tablero', 'Trámites', 'Habitualista', 'Informes', 'Análisis', 'Rendiciones', 'Usuarios'])
  expect(et('admin')).toEqual(['Usuarios'])
  expect(et('contable')).toEqual(['Tablero', 'Trámites', 'Habitualista', 'Informes', 'Análisis', 'Rendiciones'])
  expect(et('gestora')).toEqual(['Mis trámites'])
  expect(et(null)).toEqual([])
})

it('el menú tiene el mismo orden para todos, pero el contable arranca en Trámites', () => {
  expect(inicioPorRol('contable')).toBe('/tramites')
  expect(inicioPorRol('gerencia')).toBe('/tablero')
  expect(inicioPorRol('gestora')).toBe('/mis-tramites')
  expect(inicioPorRol(null)).toBeUndefined()
})

it('la barra del celular tiene como máximo 5 accesos: 4 fijos + Más', () => {
  const g = partirBarraMovil(navegacionPorRol('gerencia'))
  expect(g.fijos.map((i) => i.etiqueta)).toEqual(['Tablero', 'Trámites', 'Habitualista', 'Informes'])
  expect(g.mas.map((i) => i.etiqueta)).toEqual(['Análisis', 'Rendiciones', 'Usuarios'])
  expect(partirBarraMovil(navegacionPorRol('gestora')).mas).toEqual([])
})
