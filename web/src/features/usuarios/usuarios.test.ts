import { describe, expect, it } from 'vitest'
import type { Rol } from '../../lib/sesion'
import {
  alcancesDesdeSeleccion,
  alcancesLegibles,
  armarUsuarios,
  errorDeFuncion,
  filtrarUsuarios,
  puedeCambiarEstado,
  puedeGestionar,
  rolesAsignables,
  seleccionDesdeAlcances,
  validarUsuario,
  type PerfilUsuario,
  type Usuario,
} from './usuarios'

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

describe('gestión de usuarios', () => {
  it('convierte alcances en selección por razón social y de vuelta', () => {
    const sel = seleccionDesdeAlcances([
      { perfil_id: 'p', empresa_id: 'e1', sucursal_id: null },
      { perfil_id: 'p', empresa_id: 'e2', sucursal_id: 's1' },
      { perfil_id: 'p', empresa_id: 'e2', sucursal_id: 's2' },
    ])
    expect(sel).toEqual({ e1: { todas: true, sucursales: [] }, e2: { todas: false, sucursales: ['s1', 's2'] } })
    expect(alcancesDesdeSeleccion(sel)).toEqual([
      { empresa_id: 'e1', sucursal_id: null },
      { empresa_id: 'e2', sucursal_id: 's1' },
      { empresa_id: 'e2', sucursal_id: 's2' },
    ])
    // Una razón social marcada sin sucursales no aporta alcance.
    expect(alcancesDesdeSeleccion({ e3: { todas: false, sucursales: [] } })).toEqual([])
  })

  it('valida el formulario según el rol', () => {
    const base = { nombre: 'Nora', rol: 'contable' as const, seleccion: { e1: { todas: true, sucursales: [] } } }
    expect(validarUsuario({ ...base, email: 'nora@grupoparis.com.ar' }, 'alta')).toBeNull()
    expect(validarUsuario({ ...base, email: 'nora' }, 'alta')).toMatch(/email/)
    expect(validarUsuario({ ...base, nombre: ' ' }, 'edicion')).toMatch(/nombre/)
    expect(validarUsuario({ ...base, seleccion: {} }, 'edicion')).toMatch(/razón social/)
    expect(validarUsuario({ ...base, rol: 'gestora', seleccion: {} }, 'edicion')).toBeNull()
  })

  it('gerencia no asigna ni gestiona administradores; nadie se gestiona el estado a sí mismo', () => {
    expect(rolesAsignables('admin').map((r) => r.id)).toContain('admin')
    expect(rolesAsignables('gerencia').map((r) => r.id)).not.toContain('admin')
    const u = (rol: Rol, id = 'otro') => ({ id, rol }) as Usuario
    expect(puedeGestionar('gerencia', 'yo', u('admin'))).toBe(false)
    expect(puedeGestionar('gerencia', 'yo', u('contable'))).toBe(true)
    expect(puedeGestionar('admin', 'yo', u('admin'))).toBe(true)
    expect(puedeGestionar('contable', 'yo', u('gestora'))).toBe(false)
    expect(puedeCambiarEstado('admin', 'yo', u('admin', 'yo'))).toBe(false)
  })

  it('lee el código de error del cuerpo de la Edge Function', async () => {
    const err = { context: new Response(JSON.stringify({ error: 'DUPLICADO: ya existe' }), { status: 409 }) }
    expect(await errorDeFuncion(err)).toEqual(new Error('DUPLICADO: ya existe'))
    expect((await errorDeFuncion(new Error('red'))).message).toBe('red')
  })
})
