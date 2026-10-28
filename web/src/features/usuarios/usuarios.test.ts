import { describe, expect, it } from 'vitest'
import { alcancesLegibles, armarUsuarios, filtrarUsuarios, type PerfilUsuario } from './usuarios'

const empresas = [{ id: 'e1', nombre: 'Paris Autos' }, { id: 'e2', nombre: 'Paris Cars' }]
const sucursales = [{ id: 's1', nombre: 'Rivadavia' }, { id: 's2', nombre: 'Casa central' }]

describe('alcancesLegibles', () => {
  it('agrupa por razón social y distingue empresa entera de sucursales', () => {
    expect(
      alcancesLegibles(
        [
          { perfil_id: 'p', empresa_id: 'e2', sucursal_id: 's1' },
          { perfil_id: 'p', empresa_id: 'e2', sucursal_id: 's2' },
          { perfil_id: 'p', empresa_id: 'e1', sucursal_id: null },
        ],
        empresas,
        sucursales,
      ),
    ).toEqual([
      { empresa: 'Paris Autos', detalle: 'Todas las sucursales' },
      { empresa: 'Paris Cars', detalle: 'Casa central, Rivadavia' },
    ])
  })
})

describe('armarUsuarios y filtrarUsuarios', () => {
  const perfiles: PerfilUsuario[] = [
    { id: 'g', nombre: 'Gabriela', rol: 'gestora', activo: true },
    { id: 'x', nombre: 'Ana', rol: 'contable', activo: false },
    { id: 'c', nombre: 'Carla', rol: 'contable', activo: true },
    { id: 'a', nombre: 'Gustavo', rol: 'gerencia', activo: true },
  ]
  const lista = armarUsuarios(perfiles, [{ perfil_id: 'c', empresa_id: 'e1', sucursal_id: null }], empresas, sucursales)

  it('ordena activos primero, luego por rol y nombre', () => {
    expect(lista.map((u) => u.id)).toEqual(['a', 'c', 'g', 'x'])
    expect(lista.find((u) => u.id === 'g')!.sinAlcances).toBe(true)
  })

  it('filtra por texto (nombre o razón social) y por rol', () => {
    expect(filtrarUsuarios(lista, 'autos', '').map((u) => u.id)).toEqual(['c'])
    expect(filtrarUsuarios(lista, '', 'contable').map((u) => u.id)).toEqual(['c', 'x'])
    expect(filtrarUsuarios(lista, 'GUS', '').map((u) => u.id)).toEqual(['a'])
  })
})
