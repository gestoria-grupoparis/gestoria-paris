import { describe, expect, test, vi } from 'vitest'
import { manejarInvitacion, type Dependencias } from '../../supabase/functions/invitar-usuario/handler'

const cuerpo = { email: 'nueva@grupoparis.com.ar', nombre: 'Nora Nueva', rol: 'contable', alcances: [{ empresa_id: 'e1', sucursal_id: null }] }

function deps(over: Partial<Dependencias> = {}): Dependencias {
  return {
    usuarioActual: vi.fn(async () => 'yo'),
    rpcComoUsuario: vi.fn(async (fn: string) => (fn === 'mi_rol' ? { data: 'admin', error: null } : { data: null, error: null })),
    invitar: vi.fn(async () => ({ id: 'nuevo-id', error: null })),
    borrarUsuarioAuth: vi.fn(async () => {}),
    urlApp: 'https://app.grupoparis.com.ar',
    ...over,
  }
}

describe('invitar-usuario', () => {
  test('invita con redirect a /definir-clave y crea el perfil como quien llama', async () => {
    const d = deps()
    const r = await manejarInvitacion(cuerpo, 'Bearer x', d)
    expect(r).toEqual({ status: 200, body: { id: 'nuevo-id' } })
    expect(d.invitar).toHaveBeenCalledWith('nueva@grupoparis.com.ar', 'https://app.grupoparis.com.ar/definir-clave', { nombre: 'Nora Nueva' })
    expect(d.rpcComoUsuario).toHaveBeenCalledWith('validar_alta_usuario', { p_rol: 'contable', p_alcances: cuerpo.alcances })
    expect(d.rpcComoUsuario).toHaveBeenCalledWith('alta_perfil', { p_id: 'nuevo-id', p_nombre: 'Nora Nueva', p_rol: 'contable', p_alcances: cuerpo.alcances })
  })

  test('sin sesión o sin rol admin/gerencia no invita', async () => {
    expect((await manejarInvitacion(cuerpo, null, deps())).status).toBe(401)
    const sinUsuario = deps({ usuarioActual: vi.fn(async () => null) })
    expect((await manejarInvitacion(cuerpo, 'Bearer x', sinUsuario)).status).toBe(401)
    const contable = deps({ rpcComoUsuario: vi.fn(async () => ({ data: 'contable', error: null })) })
    const r = await manejarInvitacion(cuerpo, 'Bearer x', contable)
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: expect.stringMatching(/^SIN_PERMISO/) })
    expect(contable.invitar).not.toHaveBeenCalled()
  })

  test('valida email y nombre antes de invitar', async () => {
    const d = deps()
    expect((await manejarInvitacion({ ...cuerpo, email: 'no-es-mail' }, 'Bearer x', d)).body).toEqual({ error: expect.stringMatching(/^DATO_INVALIDO/) })
    expect((await manejarInvitacion({ ...cuerpo, nombre: ' ' }, 'Bearer x', d)).status).toBe(400)
    expect(d.invitar).not.toHaveBeenCalled()
  })

  test('si la validación previa rechaza, no manda el mail', async () => {
    const d = deps({
      rpcComoUsuario: vi.fn(async (fn: string) =>
        fn === 'mi_rol' ? { data: 'gerencia', error: null } : { data: null, error: { message: 'EMPRESA_DISTINTA: no podés otorgar' } }),
    })
    const r = await manejarInvitacion(cuerpo, 'Bearer x', d)
    expect(r).toEqual({ status: 400, body: { error: 'EMPRESA_DISTINTA: no podés otorgar' } })
    expect(d.invitar).not.toHaveBeenCalled()
  })

  test('email ya registrado es DUPLICADO', async () => {
    const d = deps({ invitar: vi.fn(async () => ({ id: null, error: { message: 'A user with this email address has already been registered', status: 422 } })) })
    const r = await manejarInvitacion(cuerpo, 'Bearer x', d)
    expect(r).toEqual({ status: 409, body: { error: expect.stringMatching(/^DUPLICADO/) } })
  })

  test('si el alta del perfil falla, borra el usuario invitado', async () => {
    const d = deps({
      rpcComoUsuario: vi.fn(async (fn: string) =>
        fn === 'mi_rol' ? { data: 'admin', error: null } : fn === 'alta_perfil' ? { data: null, error: { message: 'DUPLICADO: ya tiene perfil' } } : { data: null, error: null }),
    })
    const r = await manejarInvitacion(cuerpo, 'Bearer x', d)
    expect(r).toEqual({ status: 400, body: { error: 'DUPLICADO: ya tiene perfil' } })
    expect(d.borrarUsuarioAuth).toHaveBeenCalledWith('nuevo-id')
  })
})
