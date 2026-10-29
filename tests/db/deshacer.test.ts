import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

// Errores de clic: todo paso del circuito se puede deshacer con motivo y queda en el historial.
async function preparar() {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const ajena = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const otra = await crearUsuario('gestora', [])
  const [{ id: empresa }] = await sqlAdmin(`select id from public.empresas where nombre = 'Paris Autos'`)
  const [{ id: sucursal }] = await sqlAdmin(`select id from public.sucursales where nombre = 'Merlo'`)
  await rpc(contable, 'registrar_carga', { p_idem: randomUUID(), p_empresa: empresa, p_importe: 1000000n, p_fecha: '2026-10-31' })
  const t = (
    await rpc(contable, 'crear_tramite', {
      p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'patentamiento_0km',
      p_cliente: 'Ana', p_cuenta_personal: 'CP-1', p_oferta: 'OF-1', p_vehiculo: 'Honda Wave', p_dominio: 'A123BCD',
    })
  ).rows[0].crear_tramite as string
  await rpc(contable, 'autorizar_tramite', { p_tramite: t, p_gestora: gestora, p_version: 1 })
  await rpc(gestora, 'registrar_presupuesto', { p_tramite: t, p_arancel: 100000n, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: null })
  const estado = (por: string, hacia: string, motivo: string | null = null) =>
    sqlAdmin(`select version from public.tramites where id = $1`, [t]).then(([{ version }]) =>
      rpc(por, 'cambiar_estado', { p_tramite: t, p_estado: hacia, p_motivo: motivo, p_version: version }))
  const actual = async () => (await sqlAdmin(`select estado from public.tramites where id = $1`, [t]))[0].estado
  const marcas = async () => (await sqlAdmin(`select marca from public.tramite_marcas where tramite_id = $1 order by 1`, [t])).map((r) => r.marca)
  const aprobado = async () => (await sqlAdmin(`select public.presupuesto_aprobado($1) as a`, [t]))[0].a
  return { contable, ajena, gestora, otra, t, estado, actual, marcas, aprobado }
}

test('la empresa quita una marca puesta por error, con motivo; queda en eventos', async () => {
  const f = await preparar()
  await rpc(f.contable, 'marcar', { p_tramite: f.t, p_marca: 'entregado' })
  await expect(rpc(f.contable, 'desmarcar', { p_tramite: f.t, p_marca: 'entregado', p_motivo: ' ' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(rpc(f.ajena, 'desmarcar', { p_tramite: f.t, p_marca: 'entregado', p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(f.gestora, 'desmarcar', { p_tramite: f.t, p_marca: 'entregado', p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO:/)
  await rpc(f.contable, 'desmarcar', { p_tramite: f.t, p_marca: 'entregado', p_motivo: 'lo toqué sin querer' })
  expect(await f.marcas()).toEqual([])
  await expect(rpc(f.contable, 'desmarcar', { p_tramite: f.t, p_marca: 'entregado', p_motivo: 'x' })).rejects.toThrow(/^NO_ENCONTRADO:/)
  const [ev] = await sqlAdmin(
    `select accion, motivo from public.eventos where entidad = 'tramite_marcas' and accion = 'delete' order by id desc limit 1`,
  )
  expect(ev).toEqual({ accion: 'delete', motivo: 'lo toqué sin querer' })
  // Se puede volver a marcar.
  await rpc(f.contable, 'marcar', { p_tramite: f.t, p_marca: 'entregado' })
  expect(await f.marcas()).toEqual(['entregado'])
})

test('la gestora deshace "retiré el legajo" solo antes de presentar', async () => {
  const f = await preparar()
  await rpc(f.contable, 'aprobar_presupuesto', { p_tramite: f.t, p_version: 1 })
  await rpc(f.gestora, 'marcar', { p_tramite: f.t, p_marca: 'retirado' })
  await expect(rpc(f.otra, 'desmarcar', { p_tramite: f.t, p_marca: 'retirado', p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO:/)
  await rpc(f.gestora, 'desmarcar', { p_tramite: f.t, p_marca: 'retirado', p_motivo: 'todavía no lo retiré' })
  expect(await f.marcas()).toEqual([])
  await rpc(f.gestora, 'marcar', { p_tramite: f.t, p_marca: 'retirado' })
  await f.estado(f.gestora, 'presentado')
  await expect(rpc(f.gestora, 'desmarcar', { p_tramite: f.t, p_marca: 'retirado', p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO:/)
})

test('volver un paso atrás exige motivo; la gestora deshace sus pasos y la empresa reabre un cierre', async () => {
  const f = await preparar()
  await rpc(f.contable, 'aprobar_presupuesto', { p_tramite: f.t, p_version: 1 })
  await rpc(f.gestora, 'marcar', { p_tramite: f.t, p_marca: 'retirado' })
  await f.estado(f.gestora, 'presentado')

  await expect(f.estado(f.gestora, 'autorizado')).rejects.toThrow(/^DATO_INVALIDO:/)
  await f.estado(f.gestora, 'autorizado', 'lo marqué antes de ir al registro')
  expect(await f.actual()).toBe('autorizado')
  await f.estado(f.gestora, 'presentado')
  await f.estado(f.gestora, 'finalizado_registro')
  await f.estado(f.gestora, 'presentado', 'el registro todavía no terminó')
  await f.estado(f.gestora, 'finalizado_registro')
  await f.estado(f.gestora, 'devuelto')
  await f.estado(f.gestora, 'finalizado_registro', 'no lo devolví todavía')
  await f.estado(f.gestora, 'devuelto')
  await f.estado(f.contable, 'cerrado')
  // Cerrar y reabrir es de la empresa.
  await expect(f.estado(f.gestora, 'devuelto', 'x')).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(f.estado(f.contable, 'devuelto')).rejects.toThrow(/^DATO_INVALIDO:/)
  await f.estado(f.contable, 'devuelto', 'se cerró por error')
  expect(await f.actual()).toBe('devuelto')
  // Saltos de más de un paso siguen prohibidos.
  await expect(f.estado(f.contable, 'autorizado', 'x')).rejects.toThrow(/^TRANSICION_INVALIDA:/)

  const [ev] = await sqlAdmin(
    `select motivo from public.eventos where entidad = 'tramites' and despues->>'estado' = 'devuelto' order by id desc limit 1`,
  )
  expect(ev.motivo).toBe('se cerró por error')
})

test('la empresa retira una aprobación hecha por error, antes de presentar', async () => {
  const f = await preparar()
  await expect(rpc(f.contable, 'revocar_aprobacion', { p_tramite: f.t, p_motivo: 'x' })).rejects.toThrow(/^NO_ENCONTRADO:/)
  await rpc(f.contable, 'aprobar_presupuesto', { p_tramite: f.t, p_version: 1 })
  await expect(rpc(f.contable, 'revocar_aprobacion', { p_tramite: f.t, p_motivo: '' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(rpc(f.gestora, 'revocar_aprobacion', { p_tramite: f.t, p_motivo: 'x' })).rejects.toThrow(/^SIN_PERMISO:/)
  await rpc(f.contable, 'revocar_aprobacion', { p_tramite: f.t, p_motivo: 'aprobé el equivocado' })
  expect(await f.aprobado()).toBe(false)
  await expect(rpc(f.gestora, 'marcar', { p_tramite: f.t, p_marca: 'retirado' })).rejects.toThrow(/^NO_AUTORIZADO:/)
  // Se vuelve a aprobar sin problema.
  await rpc(f.contable, 'aprobar_presupuesto', { p_tramite: f.t, p_version: 1 })
  expect(await f.aprobado()).toBe(true)
  await rpc(f.gestora, 'marcar', { p_tramite: f.t, p_marca: 'retirado' })
  await f.estado(f.gestora, 'presentado')
  await expect(rpc(f.contable, 'revocar_aprobacion', { p_tramite: f.t, p_motivo: 'x' })).rejects.toThrow(/^TRANSICION_INVALIDA:/)
})
