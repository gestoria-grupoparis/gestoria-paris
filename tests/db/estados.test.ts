import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test } from 'vitest'
import { crearUsuario, resetDb, rpc, sqlAdmin } from './helpers'

beforeEach(resetDb)

const idPorNombre = async (tabla: 'empresas' | 'sucursales', nombre: string) =>
  (await sqlAdmin(`select id from public.${tabla} where nombre = $1`, [nombre]))[0].id as string

const crearTramite = async (userId: string, oferta = 'OF-555') => {
  const r = await rpc(userId, 'crear_tramite', {
    p_idem: randomUUID(),
    p_empresa: await idPorNombre('empresas', 'Paris Autos'),
    p_sucursal: await idPorNombre('sucursales', 'San Luis'),
    p_tipo: 'patentamiento_0km',
    p_cliente: 'Juan Pérez',
    p_cuenta_personal: 'CP-1001',
    p_oferta: oferta,
    p_vehiculo: 'Fiat Cronos 1.3',
    p_dominio: 'AB123CD',
  })
  return r.rows[0].crear_tramite as string
}

const tramite = async (id: string) =>
  (await sqlAdmin(`select * from public.tramites where id = $1`, [id]))[0]

const autorizar = (userId: string, id: string, gestora: string, version: number) =>
  rpc(userId, 'autorizar_tramite', { p_tramite: id, p_gestora: gestora, p_version: version })

const cambiarEstado = (userId: string, id: string, estado: string, version: number, motivo: string | null = null) =>
  rpc(userId, 'cambiar_estado', { p_tramite: id, p_estado: estado, p_motivo: motivo, p_version: version })

const permitida = async (desde: string, hacia: string, rol: string, asignada = false) =>
  (
    await sqlAdmin('select public.transicion_permitida($1, $2, $3, $4) as ok', [desde, hacia, rol, asignada])
  )[0].ok as boolean

test('autorizar exige rol habilitado y deja autorizado_por y autorizado_at', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos', sucursal: 'San Luis' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  // Gestora, comercial y admin no autorizan; gerencia sin alcance en la empresa tampoco.
  for (const rol of ['gestora', 'comercial', 'admin'] as const) {
    const u = await crearUsuario(rol, [{ empresa: 'Paris Autos' }])
    await expect(autorizar(u, id, gestora, 1)).rejects.toThrow(/^SIN_PERMISO:/)
  }
  const gerenteCars = await crearUsuario('gerencia', [{ empresa: 'Paris Cars' }])
  await expect(autorizar(gerenteCars, id, gestora, 1)).rejects.toThrow(/^SIN_PERMISO:/)

  // La gestora elegida debe ser un perfil activo con rol gestora.
  await expect(autorizar(gerente, id, contable, 1)).rejects.toThrow(/^DATO_INVALIDO:/)
  const inactiva = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  await sqlAdmin('update public.perfiles set activo = false where id = $1', [inactiva])
  await expect(autorizar(gerente, id, inactiva, 1)).rejects.toThrow(/^DATO_INVALIDO:/)
  expect((await tramite(id)).estado).toBe('borrador')

  const antes = Date.now()
  await autorizar(gerente, id, gestora, 1)

  const t = await tramite(id)
  expect(t.estado).toBe('autorizado')
  expect(t.autorizado_por).toBe(gerente)
  expect(t.gestora_id).toBe(gestora)
  expect(t.version).toBe(2)
  expect(t.autorizado_at).toBeInstanceOf(Date)
  expect(t.autorizado_at.getTime()).toBeGreaterThanOrEqual(antes - 5000)

  // Solo desde borrador: autorizar de nuevo no es una transición válida.
  await expect(autorizar(contable, id, gestora, 2)).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  // Y a autorizado solo se llega por autorizar_tramite.
  const otro = await crearTramite(contable, 'OF-556')
  await expect(cambiarEstado(contable, otro, 'autorizado', 1, 'ok')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
})

test('no se puede pasar de borrador a presentado (TRANSICION_INVALIDA)', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  await expect(cambiarEstado(contable, id, 'presentado', 1)).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(cambiarEstado(contable, id, 'cerrado', 1)).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  const t = await tramite(id)
  expect(t.estado).toBe('borrador')
  expect(t.version).toBe(1)

  // La tabla de transiciones, probada aparte.
  expect(await permitida('borrador', 'presentado', 'gerencia')).toBe(false)
  expect(await permitida('borrador', 'observado', 'contable')).toBe(true)
  expect(await permitida('borrador', 'autorizado', 'gerencia')).toBe(false)
  expect(await permitida('autorizado', 'presentado', 'gestora', true)).toBe(true)
  expect(await permitida('autorizado', 'presentado', 'gestora', false)).toBe(false)
  expect(await permitida('presentado', 'finalizado_registro', 'gestora', true)).toBe(true)
  expect(await permitida('autorizado', 'en_gestoria', 'gestora', true)).toBe(false)
  expect(await permitida('finalizado_registro', 'devuelto', 'gestora', true)).toBe(false)
  expect(await permitida('devuelto', 'cerrado', 'contable')).toBe(true)
  expect(await permitida('cerrado', 'cancelado', 'gerencia')).toBe(false)
  expect(await permitida('rechazado', 'suspendido', 'gerencia')).toBe(false)
  expect(await permitida('presentado', 'suspendido', 'gestora', true)).toBe(false)
  expect(await permitida('suspendido', 'cancelado', 'contable')).toBe(true)
  expect(await permitida('suspendido', 'suspendido', 'contable')).toBe(false)
})

test('observar sin motivo da DATO_INVALIDO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  await expect(cambiarEstado(contable, id, 'observado', 1)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(cambiarEstado(contable, id, 'observado', 1, '   ')).rejects.toThrow(/^DATO_INVALIDO:/)
  expect((await tramite(id)).estado).toBe('borrador')

  await cambiarEstado(contable, id, 'observado', 1, 'falta la factura')
  const t = await tramite(id)
  expect(t.estado).toBe('observado')
  expect(t.version).toBe(2)
  const [e] = await sqlAdmin(
    `select motivo, actor_id from public.eventos
      where entidad = 'tramites' and entidad_id = $1 and accion = 'update'`,
    [id],
  )
  expect(e).toEqual({ motivo: 'falta la factura', actor_id: contable })

  // Volver a borrador no exige motivo.
  await cambiarEstado(contable, id, 'borrador', 2)
  expect((await tramite(id)).estado).toBe('borrador')
})

test('gestora asignada marca presentado; otra gestora recibe SIN_PERMISO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const asignada = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const otra = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await autorizar(contable, id, asignada, 1)

  await expect(cambiarEstado(otra, id, 'presentado', 2)).rejects.toThrow(/^SIN_PERMISO:/)
  // La asignada no puede mover estados reservados a gerencia/contable.
  await expect(cambiarEstado(asignada, id, 'en_gestoria', 2)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(cambiarEstado(asignada, id, 'cancelado', 2, 'no va')).rejects.toThrow(/^SIN_PERMISO:/)

  await cambiarEstado(asignada, id, 'presentado', 2)
  expect((await tramite(id)).estado).toBe('presentado')
  await expect(cambiarEstado(otra, id, 'finalizado_registro', 3)).rejects.toThrow(/^SIN_PERMISO:/)
  await cambiarEstado(asignada, id, 'finalizado_registro', 3)
  expect((await tramite(id)).estado).toBe('finalizado_registro')

  // Marca "retirado": la gestora asignada sí, otra gestora no; el resto de marcas, gerencia/contable.
  await expect(rpc(otra, 'marcar', { p_tramite: id, p_marca: 'retirado' })).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(asignada, 'marcar', { p_tramite: id, p_marca: 'entregado' })).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(contable, 'marcar', { p_tramite: id, p_marca: 'inventada' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await rpc(asignada, 'marcar', { p_tramite: id, p_marca: 'retirado' })
  await rpc(asignada, 'marcar', { p_tramite: id, p_marca: 'retirado' }) // idempotente
  await rpc(contable, 'marcar', { p_tramite: id, p_marca: 'recibido_admin' })
  const marcas = await sqlAdmin(
    'select marca, por from public.tramite_marcas where tramite_id = $1 order by marca',
    [id],
  )
  expect(marcas).toEqual([
    { marca: 'recibido_admin', por: contable },
    { marca: 'retirado', por: asignada },
  ])
})

test('dos ediciones con la misma version: la segunda recibe VERSION_CONFLICTO', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)

  await cambiarEstado(contable, id, 'observado', 1, 'falta la factura')
  await expect(autorizar(gerente, id, gestora, 1)).rejects.toThrow(/^VERSION_CONFLICTO:/)
  await expect(cambiarEstado(gerente, id, 'rechazado', 1, 'no corresponde')).rejects.toThrow(
    /^VERSION_CONFLICTO:/,
  )

  const t = await tramite(id)
  expect(t.estado).toBe('observado')
  expect(t.version).toBe(2)
  expect(t.gestora_id).toBeNull()

  // En simultáneo: una sola gana.
  await cambiarEstado(contable, id, 'borrador', 2)
  const resultados = await Promise.allSettled([
    autorizar(gerente, id, gestora, 3),
    cambiarEstado(contable, id, 'rechazado', 3, 'no corresponde'),
  ])
  expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const [fallo] = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  expect(String(fallo.reason.message)).toMatch(/^VERSION_CONFLICTO:/)
  expect((await tramite(id)).version).toBe(4)
})

test('suspender y reanudar vuelve al estado previo', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await autorizar(contable, id, gestora, 1)
  await cambiarEstado(contable, id, 'en_gestoria', 2)

  await expect(cambiarEstado(contable, id, 'suspendido', 3)).rejects.toThrow(/^DATO_INVALIDO:/)
  await cambiarEstado(contable, id, 'suspendido', 3, 'falta firma del cliente')
  expect((await tramite(id)).estado).toBe('suspendido')

  // Solo se reanuda al estado previo, y con motivo.
  await expect(cambiarEstado(contable, id, 'presentado', 4, 'sigue')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(cambiarEstado(contable, id, 'autorizado', 4, 'sigue')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await expect(cambiarEstado(contable, id, 'en_gestoria', 4)).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(cambiarEstado(gestora, id, 'en_gestoria', 4, 'sigue')).rejects.toThrow(/^SIN_PERMISO:/)

  await cambiarEstado(contable, id, 'en_gestoria', 4, 'firmó')
  let t = await tramite(id)
  expect(t.estado).toBe('en_gestoria')
  expect(t.version).toBe(5)

  // Una segunda suspensión recuerda el estado de ese momento, no el de la primera.
  await cambiarEstado(gestora, id, 'presentado', 5)
  await cambiarEstado(contable, id, 'suspendido', 6, 'consulta del registro')
  await expect(cambiarEstado(contable, id, 'en_gestoria', 7, 'sigue')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
  await cambiarEstado(contable, id, 'presentado', 7, 'respondida')
  t = await tramite(id)
  expect(t.estado).toBe('presentado')

  // Desde suspendido también se puede cancelar; cancelado es final.
  await cambiarEstado(contable, id, 'suspendido', 8, 'cliente desiste')
  await cambiarEstado(contable, id, 'cancelado', 9, 'cliente desiste')
  expect((await tramite(id)).estado).toBe('cancelado')
  await expect(cambiarEstado(contable, id, 'suspendido', 10, 'x')).rejects.toThrow(/^TRANSICION_INVALIDA:/)
})

test('reasignar en lote cambia la gestora y registra el motivo en eventos', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const vieja = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const nueva = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const a = await crearTramite(contable, 'OF-1')
  const b = await crearTramite(contable, 'OF-2')
  const c = await crearTramite(contable, 'OF-3')
  for (const id of [a, b, c]) await autorizar(contable, id, vieja, 1)
  const args = { p_tramites: [a, b], p_gestora: nueva, p_motivo: 'licencia de la gestora' }

  // Solo gerencia/contable con alcance; motivo obligatorio; destino debe ser gestora activa.
  await expect(rpc(vieja, 'reasignar_gestora', args)).rejects.toThrow(/^SIN_PERMISO:/)
  const gerenteCars = await crearUsuario('gerencia', [{ empresa: 'Paris Cars' }])
  await expect(rpc(gerenteCars, 'reasignar_gestora', args)).rejects.toThrow(/^SIN_PERMISO:/)
  await expect(rpc(contable, 'reasignar_gestora', { ...args, p_motivo: ' ' })).rejects.toThrow(/^DATO_INVALIDO:/)
  await expect(rpc(contable, 'reasignar_gestora', { ...args, p_gestora: contable })).rejects.toThrow(
    /^DATO_INVALIDO:/,
  )
  await expect(
    rpc(contable, 'reasignar_gestora', { ...args, p_tramites: [a, randomUUID()] }),
  ).rejects.toThrow(/^NO_ENCONTRADO:/)
  expect((await tramite(a)).gestora_id).toBe(vieja)

  const r = await rpc(contable, 'reasignar_gestora', args)
  expect(r.rows[0].reasignar_gestora).toBe(2)

  expect((await tramite(a)).gestora_id).toBe(nueva)
  expect((await tramite(b)).gestora_id).toBe(nueva)
  expect((await tramite(c)).gestora_id).toBe(vieja)
  expect((await tramite(a)).version).toBe(3)

  const eventos = await sqlAdmin(
    `select entidad_id, actor_id, motivo, antes->>'gestora_id' as antes, despues->>'gestora_id' as despues
       from public.eventos
      where entidad = 'tramites' and accion = 'update' and motivo = 'licencia de la gestora'
      order by entidad_id`,
  )
  expect(eventos).toEqual(
    [a, b].sort().map((id) => ({
      entidad_id: id,
      actor_id: contable,
      motivo: 'licencia de la gestora',
      antes: vieja,
      despues: nueva,
    })),
  )

  // La nueva gestora ya puede operar; la anterior no.
  await expect(cambiarEstado(vieja, a, 'presentado', 3)).rejects.toThrow(/^SIN_PERMISO:/)
  await cambiarEstado(nueva, a, 'presentado', 3)
})

test('el historial de eventos de un trámite reconstruye alta → autorización → presentado con actores', async () => {
  const contable = await crearUsuario('contable', [{ empresa: 'Paris Autos' }])
  const gerente = await crearUsuario('gerencia', [{ empresa: 'Paris Autos' }])
  const gestora = await crearUsuario('gestora', [{ empresa: 'Paris Autos' }])
  const id = await crearTramite(contable)
  await autorizar(gerente, id, gestora, 1)
  await cambiarEstado(gestora, id, 'presentado', 2)

  const historial = await sqlAdmin(
    `select accion, actor_id, antes->>'estado' as desde, despues->>'estado' as hacia,
            despues->>'autorizado_por' as autorizado_por
       from public.eventos where entidad = 'tramites' and entidad_id = $1 order by id`,
    [id],
  )
  expect(historial).toEqual([
    { accion: 'insert', actor_id: contable, desde: null, hacia: 'borrador', autorizado_por: null },
    { accion: 'update', actor_id: gerente, desde: 'borrador', hacia: 'autorizado', autorizado_por: gerente },
    { accion: 'update', actor_id: gestora, desde: 'autorizado', hacia: 'presentado', autorizado_por: gerente },
  ])
})
