import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const empresa = async (nombre: string) => (await sqlAdmin(`select id from public.empresas where nombre = $1`, [nombre]))[0].id as string

test('gerencia crea una gestora con contraseña inicial; queda marcada para cambiarla', async () => {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const id = (
    await rpc(gerencia, 'crear_usuario', {
      p_email: ' Gestoria.GrupoParis+Gestora@gmail.com ', p_nombre: 'Gestora Prueba', p_rol: 'gestora',
      p_alcances: JSON.stringify([{ empresa_id: await empresa('Paris Autos') }]), p_clave: 'Inicial2026x',
    })
  ).rows[0].crear_usuario as string
  const [u] = await sqlAdmin(
    `select email, encrypted_password = extensions.crypt('Inicial2026x', encrypted_password) as ok, email_confirmed_at is not null as confirmado
       from auth.users where id = $1`, [id])
  expect(u).toEqual({ email: 'gestoria.grupoparis+gestora@gmail.com', ok: true, confirmado: true })
  expect((await sqlAdmin(`select provider, provider_id from auth.identities where user_id = $1`, [id]))[0]).toEqual({ provider: 'email', provider_id: id })
  expect((await sqlAdmin(`select rol, activo, debe_cambiar_clave from public.perfiles where id = $1`, [id]))[0])
    .toEqual({ rol: 'gestora', activo: true, debe_cambiar_clave: true })

  // La persona cambia su clave y avisa.
  await comoUsuario(id, (c) => c.query('select public.clave_cambiada()'))
  expect((await sqlAdmin(`select debe_cambiar_clave from public.perfiles where id = $1`, [id]))[0].debe_cambiar_clave).toBe(false)
})

test('validaciones: rol, permisos, email repetido y contraseña débil', async () => {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const base = { p_email: 'a@b.com', p_nombre: 'A', p_rol: 'gestora', p_alcances: '[]', p_clave: 'Inicial2026x' }
  await expect(rpc(contable, 'crear_usuario', base)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(gerencia, 'crear_usuario', { ...base, p_rol: 'admin' })).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(gerencia, 'crear_usuario', { ...base, p_clave: 'corta1' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(rpc(gerencia, 'crear_usuario', { ...base, p_clave: 'sinnumerosaqui' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(rpc(gerencia, 'crear_usuario', { ...base, p_email: 'no-es-mail' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(
    rpc(gerencia, 'crear_usuario', { ...base, p_alcances: JSON.stringify([{ empresa_id: await empresa('Paris Cars') }]), p_rol: 'contable' }),
  ).rejects.toThrow(/^EMPRESA_DISTINTA:/)
  await rpc(gerencia, 'crear_usuario', base)
  await expect(rpc(gerencia, 'crear_usuario', { ...base, p_email: 'A@B.com' })).rejects.toThrow(/^DUPLICADO:/)
})
