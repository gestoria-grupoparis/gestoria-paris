// Front y base no divergen: cada botón ofrecido pasa transicion_permitida, y cada transición
// permitida sin botón está documentada abajo como decisión.
import { beforeAll, expect, test } from 'vitest'
import { resetDb, sqlAdmin } from './helpers'
import {
  ESTADOS_POR_GRUPO,
  TODOS_LOS_ESTADOS,
  accionesGestora,
  accionesOficina,
} from '../../web/src/features/tramites/flujo'

beforeAll(resetDb)

const permitida = async (desde: string, hacia: string, rol: string, asignada = false) =>
  (await sqlAdmin('select public.transicion_permitida($1, $2, $3, $4) as ok', [desde, hacia, rol, asignada]))[0].ok as boolean

// Decisión: transiciones que la base permite a la oficina pero que no tienen botón propio.
// - borrador -> autorizado se ofrece por autorizar_tramite (no cambiar_estado): está en la UI.
// - Desde suspendido, la base acepta cualquier destino y cambiar_estado lo restringe al previo
//   (reanudar_tramite): la UI ofrece 'previo'.
// - Saltos hacia atrás de más de un paso y otros atajos quedan sin botón a propósito.
const SIN_BOTON_OFICINA: string[] = [
  // en_gestoria es un estado heredado: la UI ya no lo ofrece (autorizado y presentado alcanzan).
  'autorizado->en_gestoria',
]

test('toda acción ofrecida a la oficina pasa en la base', async () => {
  for (const e of TODOS_LOS_ESTADOS)
    for (const h of accionesOficina(e)) {
      if (h === 'previo' || (e === 'borrador' && h === 'autorizado')) continue
      for (const rol of ['gerencia', 'contable'])
        expect(`${rol} ${e}->${h} ${await permitida(e, h, rol)}`).toBe(`${rol} ${e}->${h} true`)
    }
})

test('toda acción ofrecida a la gestora asignada pasa en la base y la no asignada no puede', async () => {
  for (const [grupo, estados] of Object.entries(ESTADOS_POR_GRUPO))
    for (const retirado of [false, true])
      for (const h of accionesGestora(grupo, retirado))
        for (const e of estados) {
          if (grupo === 'presentados' && e !== 'presentado') continue
          expect(`${e}->${h} ${await permitida(e, h, 'gestora', true)}`).toBe(`${e}->${h} true`)
          expect(await permitida(e, h, 'gestora', false)).toBe(false)
        }
})

test('las transiciones permitidas sin botón están documentadas', async () => {
  const sinBoton: string[] = []
  for (const e of TODOS_LOS_ESTADOS) {
    if (e === 'suspendido') continue
    const ofrecidas = accionesOficina(e)
    for (const h of TODOS_LOS_ESTADOS)
      if (h !== e && !ofrecidas.includes(h) && (await permitida(e, h, 'contable'))) sinBoton.push(`${e}->${h}`)
  }
  expect(sinBoton).toEqual(SIN_BOTON_OFICINA)
})
