import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const id = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const nuevoAuth = async () =>
  (await sqlAdmin(`insert into auth.users (email) values ($1) returning id`, [`inv-${Math.random().toString(36).slice(2, 8)}@test.local`]))[0]
    .id as string

const alcancesDe = async (perfil: string) =>
  sqlAdmin(
    `select e.nombre as empresa, s.nombre as sucursal from public.alcances a
       join public.empresas e on e.id = a.empresa_id left join public.sucursales s on s.id = a.sucursal_id
      where a.perfil_id = $1 order by 1, 2`,
    [perfil],
  )

test('admin da de alta el perfil de un usuario invitado con sus alcances, auditado', async () => {
  const admin = await crearUsuario('admin', [])
  const nuevo = await nuevoAuth()
  const autos = await id('empresas', 'Paris Autos')
  const cars = await id('empresas', 'Paris Cars')
  const sanJuan = await id('sucursales', 'San Juan')
  await rpc(admin, 'alta_perfil', {
    p_id: nuevo,
    p_nombre: '  Carla Contable ',
    p_rol: 'contable',
    p_alcances: JSON.stringify([{ empresa_id: autos, sucursal_id: null }, { empresa_id: cars, sucursal_id: sanJuan }]),
  })
  const [p] = await sqlAdmin('select nombre, rol, activo from public.perfiles where id = $1', [nuevo])
  expect(p).toEqual({ nombre: 'Carla Contable', rol: 'contable', activo: true })
  expect(await alcancesDe(nuevo)).toEqual([
    { empresa: 'Paris Autos', sucursal: null },
    { empresa: 'Paris Cars', sucursal: 'San Juan' },
  ])
  const ev = await sqlAdmin(`select actor_id, motivo from public.eventos where entidad = 'perfiles' and entidad_id = $1`, [nuevo])
  expect(ev).toEqual([{ actor_id: admin, motivo: 'Alta de usuario por invitación' }])

  await expect(rpc(admin, 'alta_perfil', { p_id: nuevo, p_nombre: 'X', p_rol: 'contable', p_alcances: '[]' })).rejects.toThrow(/^DUPLICADO/)
})

test('alta_perfil valida rol, nombre, usuario de auth y quién llama', async () => {
  const admin = await crearUsuario('admin', [])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const nuevo = await nuevoAuth()
  await expect(rpc(contable, 'alta_perfil', { p_id: nuevo, p_nombre: 'X', p_rol: 'gestora', p_alcances: '[]' })).rejects.toThrow(/^SIN_PERMISO/)
  await expect(rpc(admin, 'alta_perfil', { p_id: nuevo, p_nombre: 'X', p_rol: 'jefe', p_alcances: '[]' })).rejects.toThrow(/^DATO_INVALIDO/)
  await expect(rpc(admin, 'alta_perfil', { p_id: nuevo, p_nombre: ' ', p_rol: 'gestora', p_alcances: '[]' })).rejects.toThrow(/^DATO_INVALIDO/)
  await expect(
    rpc(admin, 'alta_perfil', { p_id: '00000000-0000-4000-8000-000000000999', p_nombre: 'X', p_rol: 'gestora', p_alcances: '[]' }),
  ).rejects.toThrow(/^NO_ENCONTRADO/)
  await expect(
    rpc(admin, 'alta_perfil', {
      p_id: nuevo,
      p_nombre: 'X',
      p_rol: 'contable',
      p_alcances: JSON.stringify([{ empresa_id: '00000000-0000-4000-8000-000000000999', sucursal_id: null }]),
    }),
  ).rejects.toThrow(/^NO_ENCONTRADO/)
})

test('gerencia solo otorga alcances propios y no crea ni toca administradores', async () => {
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const autos = await id('empresas', 'Paris Autos')
  const motor = await id('empresas', 'Paris Motor')
  const a = await nuevoAuth()
  await expect(rpc(gerente, 'alta_perfil', { p_id: a, p_nombre: 'A', p_rol: 'admin', p_alcances: '[]' })).rejects.toThrow(/^SIN_PERMISO/)
  await expect(
    rpc(gerente, 'alta_perfil', { p_id: a, p_nombre: 'A', p_rol: 'contable', p_alcances: JSON.stringify([{ empresa_id: motor }]) }),
  ).rejects.toThrow(/^EMPRESA_DISTINTA/)
  await rpc(gerente, 'alta_perfil', { p_id: a, p_nombre: 'A', p_rol: 'contable', p_alcances: JSON.stringify([{ empresa_id: autos }]) })
  expect(await alcancesDe(a)).toEqual([{ empresa: 'Paris Autos', sucursal: null }])

  const admin = await crearUsuario('admin', [])
  await expect(rpc(gerente, 'cambiar_activo_usuario', { p_perfil: admin, p_activo: false, p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO/)
  const ajeno = await crearUsuario('contable', [{ empresa: 'Paris Motor' }])
  await expect(
    rpc(gerente, 'editar_usuario', { p_perfil: ajeno, p_nombre: 'Y', p_rol: 'contable', p_alcances: '[]', p_motivo: 'x' }),
  ).rejects.toThrow(/^EMPRESA_DISTINTA/)
})

test('editar_usuario cambia nombre, rol y reemplaza alcances con motivo auditado', async () => {
  const admin = await crearUsuario('admin', [])
  const u = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const cars = await id('empresas', 'Paris Cars')
  const sanLuis = await id('sucursales', 'San Luis Capital')
  await expect(
    rpc(admin, 'editar_usuario', { p_perfil: u, p_nombre: 'Z', p_rol: 'gerencia', p_alcances: '[]', p_motivo: ' ' }),
  ).rejects.toThrow(/^DATO_INVALIDO/)
  await rpc(admin, 'editar_usuario', {
    p_perfil: u,
    p_nombre: 'Gonzalo',
    p_rol: 'gerencia',
    p_alcances: JSON.stringify([{ empresa_id: cars, sucursal_id: sanLuis }]),
    p_motivo: 'Asciende a gerencia',
  })
  const [p] = await sqlAdmin('select nombre, rol from public.perfiles where id = $1', [u])
  expect(p).toEqual({ nombre: 'Gonzalo', rol: 'gerencia' })
  expect(await alcancesDe(u)).toEqual([{ empresa: 'Paris Cars', sucursal: 'San Luis Capital' }])
  const motivos = await sqlAdmin(
    `select distinct entidad, motivo from public.eventos where entidad_id = $1 and actor_id = $2 order by 1`,
    [u, admin],
  )
  expect(motivos).toEqual([
    { entidad: 'alcances', motivo: 'Asciende a gerencia' },
    { entidad: 'perfiles', motivo: 'Asciende a gerencia' },
  ])
  await expect(
    rpc(admin, 'editar_usuario', { p_perfil: '00000000-0000-4000-8000-000000000999', p_nombre: 'Z', p_rol: 'gestora', p_alcances: '[]', p_motivo: 'x' }),
  ).rejects.toThrow(/^NO_ENCONTRADO/)
})

test('activar y desactivar: nadie se desactiva ni se cambia el rol a sí mismo', async () => {
  const admin = await crearUsuario('admin', [])
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const g = await crearUsuario('gestora', [])
  await rpc(gerente, 'cambiar_activo_usuario', { p_perfil: g, p_activo: false, p_motivo: 'Dejó la empresa' })
  expect((await sqlAdmin('select activo from public.perfiles where id = $1', [g]))[0].activo).toBe(false)
  await rpc(admin, 'cambiar_activo_usuario', { p_perfil: g, p_activo: true, p_motivo: 'Vuelve' })
  expect((await sqlAdmin('select activo from public.perfiles where id = $1', [g]))[0].activo).toBe(true)
  await expect(rpc(admin, 'cambiar_activo_usuario', { p_perfil: admin, p_activo: false, p_motivo: 'x' })).rejects.toThrow(/^DATO_INVALIDO/)
  await expect(
    rpc(gerente, 'editar_usuario', { p_perfil: gerente, p_nombre: 'G', p_rol: 'contable', p_alcances: '[]', p_motivo: 'x' }),
  ).rejects.toThrow(/^DATO_INVALIDO/)
  await expect(rpc(g, 'cambiar_activo_usuario', { p_perfil: gerente, p_activo: false, p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO/)
})

test('validar_alta_usuario anticipa los rechazos sin escribir nada', async () => {
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const motor = await id('empresas', 'Paris Motor')
  await expect(rpc(gerente, 'validar_alta_usuario', { p_rol: 'admin', p_alcances: '[]' })).rejects.toThrow(/^SIN_PERMISO/)
  await expect(
    rpc(gerente, 'validar_alta_usuario', { p_rol: 'contable', p_alcances: JSON.stringify([{ empresa_id: motor }]) }),
  ).rejects.toThrow(/^EMPRESA_DISTINTA/)
  await rpc(gerente, 'validar_alta_usuario', { p_rol: 'gestora', p_alcances: '[]' })
})
