import { describe, expect, it } from 'vitest'
import {
  filtrosAURL, filtrosDesdeURL, formatearFechaHora, hoyEnBuenosAires, limpiarBusqueda, restarDiasHabiles, VISTAS,
} from './filtros'

describe('filtros de trámites en la URL', () => {
  it('lee los filtros conocidos e ignora vistas inexistentes y vacíos', () => {
    const f = filtrosDesdeURL(new URLSearchParams('q=AB123CD&estado=borrador&vista=inventada&gestora=&x=1'))
    expect(f).toEqual({ q: 'AB123CD', estado: 'borrador' })
  })
  it('escribe los filtros y conserva el trámite abierto', () => {
    const p = filtrosAURL({ q: 'perez', vista: 'sin_fondos' }, new URLSearchParams('t=abc&estado=borrador'))
    expect(p.toString()).toBe('t=abc&q=perez&vista=sin_fondos')
  })
  it('ida y vuelta', () => {
    const f = { empresa: 'e1', provincia: 'San Juan', desde: '2026-10-01', hasta: '2026-10-31', vista: 'demorados' as const }
    expect(filtrosDesdeURL(filtrosAURL(f, new URLSearchParams()))).toEqual(f)
  })
  it('las vistas guardadas son las del spec G.1', () => {
    expect(VISTAS.map((v) => v.etiqueta)).toEqual(['Para revisar', 'Presupuestos para aprobar', 'Autorizados sin presentar', 'Sin fondos', 'Demorados'])
  })
})

describe('utilidades', () => {
  it('limpia la búsqueda de caracteres de sintaxis PostgREST', () => {
    expect(limpiarBusqueda(' OF-1,(x)* ')).toBe('OF-1 x')
  })
  it('resta días hábiles salteando fines de semana', () => {
    expect(restarDiasHabiles('2026-10-28', 5)).toBe('2026-10-21') // miércoles -> miércoles anterior
    expect(restarDiasHabiles('2026-10-26', 1)).toBe('2026-10-23') // lunes -> viernes
  })
  it('usa la zona de Buenos Aires', () => {
    expect(hoyEnBuenosAires(new Date('2026-10-29T02:00:00Z'))).toBe('2026-10-28')
    expect(formatearFechaHora('2026-10-28T13:45:00.000Z')).toBe('28/10/2026 10:45')
  })
})
