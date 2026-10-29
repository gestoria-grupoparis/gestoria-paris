import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { mensajeError } from '../../lib/errores'
import { Button, claseControl, Field } from '../../ui'
import { IconoCheck, IconoFlecha, IconoLapiz, IconoRetorno, IconoPausa, IconoPlay, IconoProhibido, IconoUsuario } from '../../ui/Iconos'
import { formatearPesos } from '../../lib/dinero'
import { aprobarPresupuesto, autorizarTramite, cambiarEstado, revocarAprobacion, estadoPrevio, reanudarTramite, reasignarGestora, type Catalogos, type TramiteDetalle } from './consultas'
import { Dialogo } from './Dialogo'
import { etiquetaEstado } from './filtros'
import { AVANCE, RETROCESO, puedeCancelar, puedeEditar, puedeRechazar, puedeSuspender } from './flujo'
import { FormEdicion } from './FormEdicion'

type Accion = 'editar' | 'aprobar' | 'revocar' | 'retroceder' | 'autorizar' | 'observar' | 'asignar' | 'avanzar' | 'rechazar' | 'suspender' | 'reanudar' | 'cancelar' | null

const ESTADOS_ASIGNABLES = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro', 'devuelto', 'suspendido']
const PELIGRO_SUAVE = 'text-sinfondos hover:bg-sinfondos-suave'

// Acciones del panel (spec G.1 y D): autorizar, observar, asignar, avanzar, rechazar, suspender/reanudar, cancelar.
export function AccionesTramite({ tramite, catalogos }: { tramite: TramiteDetalle; catalogos: Catalogos }) {
  const [abierta, setAbierta] = useState<Accion>(null)
  const gestoras = catalogos.perfiles.filter((p) => p.rol === 'gestora' && p.activo)
  const cerrar = () => setAbierta(null)
  const e = tramite.estado
  const avance = AVANCE[e]
  const previoQ = useQuery({
    queryKey: ['tramites', 'estado-previo', tramite.id, tramite.version],
    queryFn: () => estadoPrevio(tramite.id),
    enabled: e === 'suspendido',
  })
  const previo = previoQ.data ?? null
  const fin = tramite.finanzas
  // Ping pong: la gestora presupuestó y espera que la empresa apruebe (y guarde la plata).
  const antesDePresentar = e === 'autorizado' || e === 'en_gestoria'
  const porAprobar = antesDePresentar && !!fin?.presupuesto && fin.presupuesto_version != null && !fin.presupuesto_aprobado
  const sinFondos = fin?.situacion === 'sin_fondos'
  const aprobado = antesDePresentar && !!fin?.presupuesto_aprobado
  const retroceso = RETROCESO[e]
  const cambio = (hacia: string) => (_: string, motivo: string) => cambiarEstado(tramite.id, hacia, motivo, tramite.version)

  const secundarias: ReactNode[] = []
  if (puedeEditar(e))
    secundarias.push(
      <Button key="edit" variante="secundario" tamano="sm" icono={<IconoLapiz className="size-4" />} onClick={() => setAbierta('editar')}>
        Editar datos
      </Button>,
    )
  if (e === 'borrador')
    secundarias.push(
      <Button key="obs" variante="secundario" tamano="sm" onClick={() => setAbierta('observar')}>
        Observar
      </Button>,
    )
  if (ESTADOS_ASIGNABLES.includes(e))
    secundarias.push(
      <Button key="asig" variante="secundario" tamano="sm" icono={<IconoUsuario className="size-4" />} onClick={() => setAbierta('asignar')}>
        Asignar
      </Button>,
    )
  if (aprobado)
    secundarias.push(
      <Button key="revocar" variante="secundario" tamano="sm" onClick={() => setAbierta('revocar')}>
        Retirar aprobación
      </Button>,
    )
  if (retroceso)
    secundarias.push(
      <Button key="retro" variante="secundario" tamano="sm" icono={<IconoRetorno className="size-4" />} onClick={() => setAbierta('retroceder')}>
        {retroceso.etiqueta}
      </Button>,
    )
  if (puedeSuspender(e))
    secundarias.push(
      <Button key="susp" variante="secundario" tamano="sm" icono={<IconoPausa className="size-4" />} onClick={() => setAbierta('suspender')}>
        Suspender
      </Button>,
    )
  if (e === 'suspendido')
    secundarias.push(
      <Button key="rean" variante="secundario" tamano="sm" icono={<IconoPlay className="size-4" />} cargando={previoQ.isPending} onClick={() => setAbierta('reanudar')}>
        Reanudar
      </Button>,
    )
  if (puedeRechazar(e))
    secundarias.push(
      <Button key="rech" variante="fantasma" tamano="sm" className={PELIGRO_SUAVE} onClick={() => setAbierta('rechazar')}>
        Rechazar
      </Button>,
    )
  if (puedeCancelar(e))
    secundarias.push(
      <Button key="canc" variante="fantasma" tamano="sm" icono={<IconoProhibido className="size-4" />} className={PELIGRO_SUAVE} onClick={() => setAbierta('cancelar')}>
        Cancelar trámite
      </Button>,
    )

  return (
    <div className="space-y-2.5">
      {porAprobar && (
        <div className="space-y-2 rounded-md bg-comprometido-suave px-3.5 py-3 ring-1 ring-comprometido/25">
          <p className="text-[13px] text-tinta">
            La gestora presupuestó <strong className="cifra font-semibold">{formatearPesos(fin!.presupuesto!)}</strong>.{' '}
            {sinFondos
              ? 'No hay fondos para aprobarlo: registrá una carga en Habitualista o pedile a gerencia la excepción de fondos.'
              : 'Aprobalo para que pueda retirar el legajo y presentar.'}
          </p>
          {!sinFondos && (
            <Button ancho icono={<IconoCheck className="size-4" />} onClick={() => setAbierta('aprobar')}>
              Aprobar presupuesto
            </Button>
          )}
        </div>
      )}
      {(e === 'borrador' || avance) && (
        <div className="flex flex-wrap gap-2">
          {e === 'borrador' && (
            <Button icono={<IconoCheck className="size-4" />} onClick={() => setAbierta('autorizar')} className="flex-1">
              Autorizar
            </Button>
          )}
          {avance && (
            <Button icono={<IconoFlecha className="size-4" />} onClick={() => setAbierta('avanzar')} className="flex-1">
              {avance.etiqueta}
            </Button>
          )}
        </div>
      )}
      {secundarias.length > 0 && <div className="flex flex-wrap gap-1.5">{secundarias}</div>}

      {abierta === 'editar' && <FormEdicion tramite={tramite} onCerrar={cerrar} />}
      {abierta === 'aprobar' && porAprobar && (
        <FormAccion
          titulo="Aprobar presupuesto"
          rotulo={tramite.numero}
          boton="Confirmar aprobación"
          aviso={`Se aparta ${formatearPesos(fin!.presupuesto!)} de la Habitualista de ${tramite.operacion.empresa.nombre} y la gestora recibe el aviso para retirar el legajo.`}
          ejecutar={() => aprobarPresupuesto(tramite.id, fin!.presupuesto_version!)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'autorizar' && (
        <FormAccion
          titulo="Autorizar trámite"
          rotulo={tramite.numero}
          boton="Confirmar autorización"
          pideGestora
          gestoras={gestoras}
          aviso={`Su presupuesto pasa a comprometer el saldo de ${tramite.operacion.empresa.nombre}. La gestora elegida lo recibe en su lista.`}
          ejecutar={(gestora) => autorizarTramite(tramite.id, gestora, tramite.version)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'revocar' && (
        <FormAccion
          titulo="Retirar aprobación"
          rotulo={tramite.numero}
          boton="Retirar aprobación"
          aviso="El presupuesto vuelve a quedar pendiente y la gestora no puede retirar el legajo ni presentar hasta que lo apruebes otra vez."
          pideMotivo="Indicá por qué se retira la aprobación."
          ejecutar={(_, motivo) => revocarAprobacion(tramite.id, motivo)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'retroceder' && retroceso && (
        <FormAccion
          titulo={retroceso.etiqueta}
          rotulo={tramite.numero}
          boton="Confirmar"
          aviso={`Para corregir un error: el trámite vuelve de ${etiquetaEstado(e)} a ${etiquetaEstado(retroceso.hacia)}. Queda registrado en el historial.`}
          pideMotivo="Indicá qué pasó (queda en el historial)."
          ejecutar={cambio(retroceso.hacia)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'observar' && (
        <FormAccion
          titulo="Observar trámite"
          rotulo={tramite.numero}
          boton="Confirmar observación"
          pideMotivo="Indicá el motivo de la observación."
          ejecutar={cambio('observado')}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'asignar' && (
        <FormAccion
          titulo="Asignar gestora"
          rotulo={tramite.numero}
          boton="Confirmar asignación"
          pideGestora
          gestoras={gestoras.filter((g) => g.id !== tramite.gestora_id)}
          pideMotivo="Indicá el motivo de la reasignación."
          ejecutar={(gestora, motivo) => reasignarGestora([tramite.id], gestora, motivo)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'avanzar' && avance && (
        <FormAccion
          titulo={avance.etiqueta}
          rotulo={tramite.numero}
          boton="Confirmar"
          aviso={`El trámite pasa de ${etiquetaEstado(e)} a ${etiquetaEstado(avance.hacia)}.`}
          motivoOpcional
          ejecutar={cambio(avance.hacia)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'rechazar' && (
        <FormAccion
          titulo="Rechazar trámite"
          rotulo={tramite.numero}
          boton="Confirmar rechazo"
          peligro
          aviso="Un trámite rechazado no se puede reabrir."
          pideMotivo="Indicá el motivo del rechazo."
          ejecutar={cambio('rechazado')}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'suspender' && (
        <FormAccion
          titulo="Suspender trámite"
          rotulo={tramite.numero}
          boton="Confirmar suspensión"
          aviso="Queda en pausa. Al reanudarlo vuelve al estado en que estaba."
          pideMotivo="Indicá el motivo de la suspensión."
          ejecutar={cambio('suspendido')}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'reanudar' && (
        <FormAccion
          titulo="Reanudar trámite"
          rotulo={tramite.numero}
          boton="Confirmar"
          aviso={previo ? `Vuelve a ${etiquetaEstado(previo)}.` : previoQ.isError ? mensajeError(previoQ.error) : 'Vuelve al estado en que estaba.'}
          pideMotivo="Indicá el motivo para reanudarlo."
          ejecutar={(_, motivo) => reanudarTramite(tramite.id, motivo, tramite.version)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'cancelar' && (
        <FormAccion
          titulo="Cancelar trámite"
          rotulo={tramite.numero}
          boton="Confirmar cancelación"
          peligro
          aviso="Libera el saldo comprometido y no se puede deshacer."
          pideMotivo="Indicá el motivo de la cancelación."
          ejecutar={cambio('cancelado')}
          onCerrar={cerrar}
        />
      )}
    </div>
  )
}

export interface PropsForm {
  titulo: string
  rotulo?: string
  boton: string
  pideGestora?: boolean
  /** Si está, el motivo es obligatorio y este es el mensaje cuando falta. */
  pideMotivo?: string
  motivoOpcional?: boolean
  peligro?: boolean
  gestoras?: { id: string; nombre: string }[]
  aviso?: string
  ejecutar: (gestora: string, motivo: string) => Promise<unknown>
  onCerrar: () => void
  /** Se llama tras un éxito, antes de cerrar (p. ej. para avisar el resultado). */
  onHecho?: () => void
  etiquetaMotivo?: string
}

export function FormAccion({ titulo, rotulo, boton, pideGestora, pideMotivo, motivoOpcional, peligro, gestoras = [], aviso, ejecutar, onCerrar, onHecho, etiquetaMotivo }: PropsForm) {
  const qc = useQueryClient()
  const [gestora, setGestora] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: () => ejecutar(gestora, motivo.trim()),
    onSuccess: () => {
      onHecho?.()
      onCerrar()
    },
    onError: (e) => setError(mensajeError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tramites'] }),
  })

  function confirmar(e: FormEvent) {
    e.preventDefault()
    if (pideGestora && !gestora) return setError('Elegí la gestora.')
    if (pideMotivo && !motivo.trim()) return setError(pideMotivo)
    setError(null)
    m.mutate()
  }

  return (
    <Dialogo titulo={titulo} rotulo={rotulo} onCerrar={onCerrar} bloqueado={m.isPending} sucio={!!motivo}>
      <form onSubmit={confirmar} noValidate className="space-y-4">
        {aviso && <p className="rounded-md bg-hundido px-4 py-3 text-[14px]">{aviso}</p>}
        {pideGestora && gestoras.length === 0 && (
          <p role="alert" className="rounded-md bg-comprometido-suave px-4 py-3 text-[14px] text-tinta">
            Todavía no hay gestoras activas. Invitá a la gestora desde <strong>Usuarios</strong> (rol Gestora) y volvé a intentarlo.
          </p>
        )}
        {pideGestora && gestoras.length > 0 && (
          <Field label="Gestora">
            {(p) => (
              <select {...p} className={claseControl} value={gestora} onChange={(e) => setGestora(e.target.value)}>
                <option value="">Elegí la gestora</option>
                {gestoras.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {(pideMotivo || motivoOpcional) && (
          <Field label={etiquetaMotivo ?? (motivoOpcional ? 'Nota (opcional)' : 'Motivo')}>
            {(p) => (
              <textarea {...p} rows={3} className={`${claseControl} h-auto py-2.5`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" variante={peligro ? 'peligro' : 'primario'} cargando={m.isPending} disabled={pideGestora && gestoras.length === 0}>
            {boton}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
