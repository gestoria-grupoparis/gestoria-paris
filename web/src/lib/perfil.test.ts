import { describe, expect, it } from 'vitest'
import { pantallaPara, resolverPerfil } from './perfil'

const activo = { id: 'u1', nombre: 'Ana', rol: 'gestora' as const, activo: true }

describe('resolverPerfil', () => {
  it('perfil activo', () => {
    expect(resolverPerfil({ data: activo, error: null })).toEqual({ perfil: activo, rol: 'gestora', error: null })
  })
  it('error de la consulta no se traga', () => {
    expect(resolverPerfil({ data: null, error: { message: 'JWT expired' } }).error).toBe('perfil_no_cargado')
  })
  it('perfil inexistente', () => {
    expect(resolverPerfil({ data: null, error: null }).error).toBe('perfil_no_cargado')
  })
  it('perfil inactivo', () => {
    expect(resolverPerfil({ data: { ...activo, activo: false }, error: null })).toEqual({
      perfil: null, rol: null, error: 'inactivo',
    })
  })
})

describe('pantallaPara', () => {
  const base = { cargando: false, conSesion: true, perfil: null, error: null } as const
  it('sesión sin perfil por error no muestra Login', () => {
    expect(pantallaPara({ ...base, error: 'perfil_no_cargado' })).toBe('error_perfil')
  })
  it('usuario inactivo ve aviso aun después del signOut', () => {
    expect(pantallaPara({ ...base, error: 'inactivo' })).toBe('login_inactivo')
    expect(pantallaPara({ ...base, conSesion: false, error: 'inactivo' })).toBe('login_inactivo')
  })
  it('sin sesión muestra Login', () => {
    expect(pantallaPara({ ...base, conSesion: false })).toBe('login')
  })
  it('con perfil muestra la app', () => {
    expect(pantallaPara({ ...base, perfil: activo })).toBe('app')
  })
  it('cargando', () => {
    expect(pantallaPara({ ...base, cargando: true })).toBe('cargando')
  })
})
