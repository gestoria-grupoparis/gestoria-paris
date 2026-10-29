import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { extraer } from './parsers'
import { asignarComprobante, vincularFila, type Candidato } from './vincular'

const c = (id: string, cliente: string, dominio: string | null = null): Candidato => ({
  id, numero: 'T-2026-' + id, cliente, dominio, autorizado: true,
})

test('el dominio gana sobre el nombre', () => {
  const r = vincularFila({ nombre: 'GODOY MARIO', dominio: 'AF869NV' }, [c('1', 'GODOY MARIO'), c('2', 'OTRO', 'AF869NV')])
  expect(r).toEqual({ vinculo: 'auto', tramite_id: '2', candidatos: ['2'] })
})

test('dos SUAREZ OSCAR con distinto segundo nombre no se mezclan', () => {
  const cs = [c('1', 'Suárez Oscar Raúl'), c('2', 'SUAREZ OSCAR DANIEL')]
  expect(vincularFila({ nombre: 'SUAREZ OSCAR RAUL', dominio: null }, cs)).toMatchObject({ vinculo: 'auto', tramite_id: '1' })
  expect(vincularFila({ nombre: 'SUAREZ OSCAR DANIEL', dominio: null }, cs)).toMatchObject({ vinculo: 'auto', tramite_id: '2' })
  expect(vincularFila({ nombre: 'SUAREZ OSCAR', dominio: null }, cs)).toMatchObject({ vinculo: 'ambiguo', tramite_id: null })
})

test('nombre exactamente repetido queda ambiguo con los dos candidatos', () => {
  const r = vincularFila({ nombre: 'PEREZ JUAN', dominio: null }, [c('1', 'PEREZ JUAN'), c('2', 'Pérez Juan')])
  expect(r).toEqual({ vinculo: 'ambiguo', tramite_id: null, candidatos: ['1', '2'] })
})

test('sin coincidencias queda sin vincular', () => {
  expect(vincularFila({ nombre: 'NADIE', dominio: null }, [c('1', 'PEREZ JUAN')])).toEqual({
    vinculo: 'sin_vincular', tramite_id: null, candidatos: [],
  })
})

test('una retención con dominio AA111AA va a la fila de ese dominio', () => {
  const e = extraer(readFileSync(join(__dirname, '__fixtures__', 'retencion-sellos.txt'), 'utf8'))
  const filas = [
    { id: 'f1', nombre: 'OTRO CLIENTE', dominio: 'AA111AA' },
    { id: 'f2', nombre: 'GODOY MARIO ESTEBAN', dominio: null },
  ]
  expect(asignarComprobante(e, filas)).toBe('f1')
  // sin dominio en las filas, por nombre
  expect(asignarComprobante(e, filas.map((f) => ({ ...f, dominio: null })))).toBe('f2')
  // nombre repetido: no se asigna
  expect(asignarComprobante({ ...e, dominio: null }, [filas[1], { ...filas[1], id: 'f3' }])).toBeNull()
})
