import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { mensajeError } from '../../lib/errores'
import { Button, claseControl, Field } from '../../ui'
import { IconoCheck, IconoFlecha, IconoPausa, IconoPlay, IconoProhibido, IconoUsuario } from '../../ui/Iconos'
import { autorizarTramite, cambiarEstado, historial, reasignarGestora, type Catalogos, type TramiteDetalle } from './consultas'
import { Dialogo } from './Dialogo'
import { etiquetaEstado } from './filtros'
import { AVANCE, estadoPrevioSuspension, puedeCancelar, puedeRechazar, puedeSuspender } from './flujo'

type Accion = 'autorizar' | 'observar' | 'asignar' | 'avanzar' | 'rechazar' | 'suspender' | 'reanudar' | 'cancelar' | null

const ESTADOS_ASIGNABLES = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro', 'devuelto', 'suspendido']
const PELIGRO_SUAVE = 'text-sinfondos hover:bg-sinfondos-suave'

// Acciones del panel (spec G.1 y D): autorizar, observar, asignar, avanzar, rechazar, suspender/reanudar, cancelar.
export function AccionesTramite({ tramite, catalogos }: { tramite: TramiteDetalle; catalogos: Catalogos }) {
  const [abierta, setAbierta] = useState<Accion>(null)
  const gestoras = catalogos.perfiles.filter((p) => p.rol === 'gestora' && p.activo)
  const cerrar = () => setAbierta(null)
  const e = tramite.estado
  const avance = AVANCE[e]
  const eventos = useQuery({
    queryKey: ['tramites', 'historial', tramite.id],
    queryFn: () => historial(tramite.id),
    enabled: e === 'suspendido',
  })
  const previo = eventos.data ? estadoPrevioSuspension(eventos.data) : null
  const cambio = (hacia: string) => (_: string, motivo: string) => cambiarEstado(tramite.id, hacia, motivo, tramite.version)

  const secundarias: ReactNode[] = []
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
  if (puedeSuspender(e))
    secundarias.push(
      <Button key="susp" variante="secundario" tamano="sm" icono={<IconoPausa className="size-4" />} onClick={() => setAbierta('suspender')}>
        Suspender
      </Button>,
    )
  if (e === 'suspendido')
    secundarias.push(
      <Button key="rean" variante="secundario" tamano="sm" icono={<IconoPlay className="size-4" />} disabled={!previo} onClick={() => setAbierta('reanudar')}>
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
      {abierta === 'reanudar' && previo && (
        <FormAccion
          titulo="Reanudar trámite"
          rotulo={tramite.numero}
          boton="Confirmar"
          aviso={`Vuelve a ${etiquetaEstado(previo)}.`}
          pideMotivo="Indicá el motivo para reanudarlo."
          ejecutar={cambio(previo)}
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

interface PropsForm {
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
  ejecutar: (gestora: string, motivo: string) => Promise<void>
  onCerrar: () => void
}

function FormAccion({ titulo, rotulo, boton, pideGestora, pideMotivo, motivoOpcional, peligro, gestoras = [], aviso, ejecutar, onCerrar }: PropsForm) {
  const qc = useQueryClient()
  const [gestora, setGestora] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: () => ejecutar(gestora, motivo.trim()),
    onSuccess: onCerrar,
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
    <Dialogo titulo={titulo} rotulo={rotulo} onCerrar={onCerrar}>
      <form onSubmit={confirmar} noValidate className="space-y-4">
        {aviso && <p className="rounded-md bg-hundido px-4 py-3 text-[15px]">{aviso}</p>}
        {pideGestora && (
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
          <Field label={motivoOpcional ? 'Nota (opcional)' : 'Motivo'}>
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
          <Button type="submit" variante={peligro ? 'peligro' : 'primario'} cargando={m.isPending}>
            {boton}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
