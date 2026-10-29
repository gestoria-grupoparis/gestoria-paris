import { expect, test } from '@playwright/test'
import { montarSupabase } from './mock-supabase'

const GERENTE = '00000000-0000-4000-8000-0000000000a1'
const CONTABLE = '00000000-0000-4000-8000-0000000000c1'
const ADMIN = '00000000-0000-4000-8000-0000000000ad'
const E1 = '00000000-0000-4000-8000-0000000000e1'
const E2 = '00000000-0000-4000-8000-0000000000e2'
const ADMIN_PERFIL = { id: ADMIN, nombre: 'Ana Administración', rol: 'admin', activo: true }

test('admin crea un usuario con rol, alcance y contraseña inicial, y aparece en la lista', async ({ page }) => {
  const mock = await montarSupabase(page, [], { usuario: ADMIN, perfilesExtra: [ADMIN_PERFIL] })
  await page.goto('/usuarios')
  await expect(page.getByRole('link', { name: 'Usuarios' })).toBeVisible()
  await page.getByRole('button', { name: 'Nuevo usuario' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Nuevo usuario' })
  await dialogo.getByLabel('Email').fill('nora')
  await dialogo.getByLabel('Nombre y apellido').fill('Nora Nueva')
  await dialogo.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(dialogo.getByRole('alert')).toContainText('email válido')

  await dialogo.getByLabel('Email').fill('Nora@GrupoParis.com.ar')
  await dialogo.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(dialogo.getByRole('alert')).toContainText('razón social')

  await dialogo.getByRole('checkbox', { name: 'Paris Cars' }).check()
  await dialogo.getByRole('radio', { name: 'Elegir sucursales' }).click()
  await dialogo.getByText('Rivadavia').click()
  await dialogo.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByRole('status')).toContainText('Usuario creado. Entra con nora@grupoparis.com.ar y la contraseña')
  expect(mock.invitaciones).toHaveLength(1)
  expect(String(mock.invitaciones[0].clave)).toMatch(/^[A-Za-z]{4}-[2-9]{4}-[A-Za-z]{4}$/)
  expect(mock.recuperaciones).toHaveLength(0)
  expect(mock.invitaciones[0]).toMatchObject({ email: 'nora@grupoparis.com.ar', nombre: 'Nora Nueva', rol: 'contable', alcances: [{ empresa_id: E2 }] })
  await expect(page.getByRole('table', { name: 'Usuarios' }).getByRole('row', { name: /Nora Nueva/ })).toContainText('Paris Cars · Rivadavia')
})

test('crear un email existente muestra el error sin cerrar', async ({ page }) => {
  await montarSupabase(page, [], { usuario: ADMIN, perfilesExtra: [ADMIN_PERFIL] })
  await page.goto('/usuarios')
  await page.getByRole('button', { name: 'Nuevo usuario' }).click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByLabel('Email').fill('repetido@grupoparis.com.ar')
  await dialogo.getByLabel('Nombre y apellido').fill('Repetido')
  await dialogo.getByRole('radio', { name: /Gestora/ }).check()
  await dialogo.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(dialogo.getByRole('alert')).toHaveText('Ya existe un usuario con ese email.')
})

test('gerencia edita rol y alcance con motivo, y desactiva a una gestora', async ({ page }) => {
  await montarSupabase(page, [], {
    usuario: GERENTE,
    perfilesExtra: [ADMIN_PERFIL],
    tablaAlcances: [
      { perfil_id: GERENTE, empresa_id: E1, sucursal_id: null },
      { perfil_id: GERENTE, empresa_id: E2, sucursal_id: null },
      { perfil_id: CONTABLE, empresa_id: E1, sucursal_id: null },
    ],
  })
  await page.goto('/usuarios')
  const tabla = page.getByRole('table', { name: 'Usuarios' })
  // Gerencia no gestiona administradores ni puede desactivarse a sí misma.
  await expect(tabla.getByRole('button', { name: 'Editar a Ana Administración' })).toHaveCount(0)
  await expect(tabla.getByRole('button', { name: 'Desactivar a Gustavo Gerente' })).toHaveCount(0)

  await tabla.getByRole('button', { name: 'Editar a Carla Contable' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Editar a Carla Contable' })
  await expect(dialogo.getByRole('radio', { name: /Administración/ })).toHaveCount(0)
  await expect(dialogo.getByRole('checkbox', { name: 'Paris Autos' })).toBeChecked()
  await dialogo.getByRole('checkbox', { name: 'Paris Cars' }).check()
  await dialogo.getByRole('radio', { name: /Gerencia/ }).check()
  await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(dialogo.getByRole('alert')).toContainText('motivo')
  await dialogo.getByLabel('Motivo del cambio').fill('Pasa a gerencia de las dos razones sociales')
  await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByRole('status')).toContainText('Cambios guardados para Carla Contable')
  const carla = tabla.getByRole('row', { name: /Carla Contable/ })
  await expect(carla).toContainText('Gerencia')
  await expect(carla).toContainText('Paris Cars · Todas las sucursales')

  await tabla.getByRole('button', { name: 'Desactivar a Gabriela Gestora' }).click()
  const baja = page.getByRole('dialog', { name: 'Desactivar a Gabriela Gestora' })
  await baja.getByLabel('Motivo').fill('Dejó la empresa')
  await baja.getByRole('button', { name: 'Desactivar' }).click()
  await expect(page.getByRole('status')).toContainText('Gabriela Gestora quedó inactivo')
  await expect(tabla.getByRole('row', { name: /Gabriela Gestora/ })).toContainText('Inactivo')
  await expect(tabla.getByRole('button', { name: 'Reactivar a Gabriela Gestora' })).toBeVisible()
})


test('gerencia ve el email de cada usuario y le da una contraseña nueva', async ({ page }) => {
  const mock = await montarSupabase(page, [], { usuario: GERENTE })
  await page.goto('/usuarios')
  const fila = page.getByRole('table', { name: 'Usuarios' }).getByRole('row', { name: /Silvia Gestora/ })
  await expect(fila).toContainText('silvia.gestora@grupoparis.com.ar')
  await page.getByPlaceholder(/Buscar/).fill('silvia.gestora@')
  await expect(page.getByRole('table', { name: 'Usuarios' }).getByRole('row')).toHaveCount(2)
  await fila.getByRole('button', { name: 'Nueva contraseña para Silvia Gestora' }).click()
  const d = page.getByRole('dialog', { name: 'Nueva contraseña para Silvia Gestora' })
  await expect(d).toContainText('silvia.gestora@grupoparis.com.ar')
  await d.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(d.getByRole('alert')).toContainText('motivo')
  await d.getByLabel('Motivo').fill('se la olvidó')
  await d.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page.getByRole('status')).toContainText('Contraseña nueva para Silvia Gestora (silvia.gestora@grupoparis.com.ar)')
  expect(mock.invitaciones.at(-1)).toMatchObject({ restablecer: '00000000-0000-4000-8000-000000000072' })
  await expect(fila).toContainText('Todavía no entró')
})
