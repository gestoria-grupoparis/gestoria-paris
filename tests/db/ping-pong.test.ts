import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { comoUsuario, crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const FECHA = '2026-10-30'

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

// Circuito empresa - gestora: autoriza → presupuesta → aprueba → retira → presenta → finaliza → devuelve → cierra.
async function preparar() {
  const gerencia = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const ajena = await crearUsuario('contable', [{ empresa: 'Paris Cars' }])
  const gestora = await crearUsuario('gestora', [])
  const empresa = await idPorNombre('empresas', 'Paris Autos')
  const sucursal = await idPorNombre('sucursales', 'Villa Mercedes')
  let n = 0

  const carga = (importe: bigint) =>
    rpc(gerencia, 'registrar_carga', { p_idem: randomUUID(), p_empresa: empresa, p_importe: importe, p_fecha: FECHA })

  const tramite = async () => {
    n += 1
    const id = (
      await rpc(contable, 'crear_tramite', {
        p_idem: randomUUID(), p_empresa: empresa, p_sucursal: sucursal, p_tipo: 'transferencia_usado',
        p_cliente: 'Cliente ' + n, p_cuenta_personal: 'CP-' + n, p_oferta: 'OF-' + n,
        p_vehiculo: 'Peugeot 208', p_dominio: 'AB' + n + 'CD',
      })
    ).rows[0].crear_tramite as string
    await rpc(contable, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: 1 })
    return id
  }

  const presupuestar = (id: string, total: bigint, motivo: string | null = null) =>
    rpc(gestora, 'registrar_presupuesto', {
      p_tramite: id, p_arancel: total, p_prenda: 0n, p_sellado: 0n, p_otros: 0n, p_motivo: motivo,
    })
  const aprobar = (por: string, id: string, version: number) =>
    rpc(por, 'aprobar_presupuesto', { p_tramite: id, p_version: version })
  const estado = (por: string, id: string, hacia: string, version: number) =>
    rpc(por, 'cambiar_estado', { p_tramite: id, p_estado: hacia, p_motivo: null, p_version: version })
  const finanzasDe = (perfil: string, id: string) =>
    comoUsuario(perfil, async (c) =>
      (await c.query(`select presupuesto_version, presupuesto_aprobado, situacion from public.v_tramite_finanzas where tramite_id = $1`, [id])).rows[0],
    )
  const avisos = (perfil: string) =>
    comoUsuario(perfil, async (c) => (await c.query(`select tipo from public.notificaciones order by created_at`)).rows.map((r) => r.tipo))
  const estadoDe = async (id: string) =>
    (await sqlAdmin(`select estado, version from public.tramites where id = $1`, [id]))[0] as { estado: string; version: number }

  return { gerencia, contable, ajena, gestora, empresa, carga, tramite, presupuestar, aprobar, estado, finanzasDe, avisos, estadoDe }
}

test('circuito completo: la gestora no avanza hasta que la empresa aprueba el presupuesto', async () => {
  const f = await preparar()
  await f.carga(500000n)
  const t = await f.tramite()

  await f.presupuestar(t, 120000n)
  expect(await f.finanzasDe(f.gestora, t)).toMatchObject({ presupuesto_version: 1, presupuesto_aprobado: false })

  // Sin aprobación no retira el legajo ni presenta.
  await expect(rpc(f.gestora, 'marcar', { p_tramite: t, p_marca: 'retirado' })).rejects.toThrow(/^NO_AUTORIZADO:/)
  await expect(f.estado(f.gestora, t, 'presentado', 2)).rejects.toThrow(/^NO_AUTORIZADO:/)
  // La gestora no se aprueba a sí misma.
  await expect(f.aprobar(f.gestora, t, 1)).rejects.toThrow(/^SIN_PERMISO:/)

  await f.aprobar(f.contable, t, 1)
  await f.aprobar(f.contable, t, 1) // idempotente
  expect(await f.finanzasDe(f.gestora, t)).toMatchObject({ presupuesto_aprobado: true })
  expect(await f.avisos(f.gestora)).toContain('presupuesto_aprobado')

  // Aprobado: igual tiene que retirar el legajo antes de presentar.
  await expect(f.estado(f.gestora, t, 'presentado', 2)).rejects.toThrow(/^DATO_INVALIDO:/)
  await rpc(f.gestora, 'marcar', { p_tramite: t, p_marca: 'retirado' })
  await f.estado(f.gestora, t, 'presentado', 2)
  await f.estado(f.gestora, t, 'finalizado_registro', 3)
  await f.estado(f.gestora, t, 'devuelto', 4)
  // Cerrar es de la empresa.
  await expect(f.estado(f.gestora, t, 'cerrado', 5)).rejects.toThrow(/^SIN_PERMISO:/)
  await f.estado(f.contable, t, 'cerrado', 5)
  expect(await f.estadoDe(t)).toEqual({ estado: 'cerrado', version: 6 })
})

test('sin fondos no se aprueba; con una carga sí', async () => {
  const f = await preparar()
  const t = await f.tramite()
  await f.presupuestar(t, 90000n)
  expect(await f.finanzasDe(f.gerencia, t)).toMatchObject({ situacion: 'sin_fondos' })
  await expect(f.aprobar(f.gerencia, t, 1)).rejects.toThrow(/^NO_AUTORIZADO:/)
  await f.carga(90000n)
  await f.aprobar(f.gerencia, t, 1)
  expect(await f.finanzasDe(f.gerencia, t)).toMatchObject({ presupuesto_aprobado: true })
})

test('si la gestora cambia el presupuesto, hay que volver a aprobarlo', async () => {
  const f = await preparar()
  await f.carga(500000n)
  const t = await f.tramite()
  await f.presupuestar(t, 100000n)
  await f.aprobar(f.contable, t, 1)
  await f.presupuestar(t, 130000n, 'el sellado subió')

  expect(await f.finanzasDe(f.gestora, t)).toMatchObject({ presupuesto_version: 2, presupuesto_aprobado: false })
  await expect(f.aprobar(f.contable, t, 1)).rejects.toThrow(/^VERSION_CONFLICTO:/)
  await f.aprobar(f.contable, t, 2)
  expect(await f.finanzasDe(f.gestora, t)).toMatchObject({ presupuesto_aprobado: true })
})

test('aprobar exige alcance, presupuesto y un estado previo a presentar', async () => {
  const f = await preparar()
  await f.carga(500000n)
  const t = await f.tramite()
  await expect(f.aprobar(f.contable, t, 1)).rejects.toThrow(/^NO_ENCONTRADO:/)
  await f.presupuestar(t, 100000n)
  await expect(f.aprobar(f.ajena, t, 1)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(f.aprobar(f.contable, randomUUID(), 1)).rejects.toThrow(/^NO_ENCONTRADO:/)
  await f.aprobar(f.contable, t, 1)
  await rpc(f.gestora, 'marcar', { p_tramite: t, p_marca: 'retirado' })
  await f.estado(f.gestora, t, 'presentado', 2)
  await expect(f.aprobar(f.contable, t, 1)).rejects.toThrow(/^TRANSICION_INVALIDA:/)
})

test('la gestora ve disponible y apartado de las razones sociales con las que trabaja', async () => {
  const f = await preparar()
  await f.carga(500000n)
  const saldos = (perfil: string) =>
    comoUsuario(perfil, async (c) => (await c.query(`select empresa, disponible_cents, comprometido_cents from public.saldos_gestora()`)).rows)

  // Sin trámites ni alcances, nada.
  expect(await saldos(f.gestora)).toEqual([])
  const t = await f.tramite()
  await f.presupuestar(t, 120000n)
  expect(await saldos(f.gestora)).toEqual([{ empresa: 'Paris Autos', disponible_cents: 380000n, comprometido_cents: 120000n }])
  // Es solo para la gestora: gerencia usa v_saldos.
  expect(await saldos(f.gerencia)).toEqual([])
})

test('Doral y Paris Track existen sin Habitualista; San Luis tiene tres ciudades', async () => {
  const sinCuenta = await sqlAdmin(
    `select e.nombre from public.empresas e where not exists (select 1 from public.cuentas c where c.empresa_id = e.id) order by 1`,
  )
  expect(sinCuenta.map((r) => r.nombre)).toEqual(['Doral', 'Paris Track'])
  const sl = await sqlAdmin(`select nombre from public.sucursales where provincia = 'San Luis' order by 1`)
  expect(sl.map((r) => r.nombre)).toEqual(['Merlo', 'San Luis Capital', 'Villa Mercedes'])
})
