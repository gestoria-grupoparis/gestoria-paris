import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { mensajeError } from '../../lib/errores'
import { autorizarTramite, cambiarEstado, marcar, reasignarGestora, type Catalogos, type TramiteDetalle } from './consultas'
import { CLASE_CAMPO, CLASE_ETIQUETA, CLASE_PRIMARIO, CLASE_SECUNDARIO, Dialogo } from './Dialogo'

type Accion = 'autorizar' | 'observar' | 'asignar' | null

const ESTADOS_ASIGNABLES = ['autorizado', 'en_gestoria', 'presentado', 'finalizado_registro', 'devuelto', 'suspendido']

// Acciones rápidas del panel (spec G.1): Autorizar, Observar, Asignar, Marcar entregado.
export function AccionesTramite({ tramite, catalogos }: { tramite: TramiteDetalle; catalogos: Catalogos }) {
  const [abierta, setAbierta] = useState<Accion>(null)
  const qc = useQueryClient()
  const gestoras = catalogos.perfiles.filter((p) => p.rol === 'gestora' && p.activo)
  const entregado = tramite.marcas.some((m) => m.marca === 'entregado')
  const cerrar = () => setAbierta(null)

  const marcarEntregado = useMutation({
    mutationFn: () => marcar(tramite.id, 'entregado'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tramites'] }),
  })

  return (
    <div className="flex flex-wrap gap-1.5">
      {tramite.estado === 'borrador' && (
        <>
          <button type="button" className={CLASE_PRIMARIO} onClick={() => setAbierta('autorizar')}>
            Autorizar
          </button>
          <button type="button" className={CLASE_SECUNDARIO} onClick={() => setAbierta('observar')}>
            Observar
          </button>
        </>
      )}
      {ESTADOS_ASIGNABLES.includes(tramite.estado) && (
        <button type="button" className={CLASE_SECUNDARIO} onClick={() => setAbierta('asignar')}>
          Asignar
        </button>
      )}
      {!entregado && (
        <button
          type="button"
          className={CLASE_SECUNDARIO}
          disabled={marcarEntregado.isPending}
          onClick={() => marcarEntregado.mutate()}
        >
          Marcar entregado
        </button>
      )}
      {marcarEntregado.isError && (
        <p role="alert" className="w-full text-sm text-alerta">
          {mensajeError(marcarEntregado.error)}
        </p>
      )}

      {abierta === 'autorizar' && (
        <FormAccion
          titulo="Autorizar trámite"
          boton="Confirmar autorización"
          pideGestora
          gestoras={gestoras}
          aviso={`Vas a autorizar ${tramite.numero}. Su presupuesto pasa a comprometer el saldo de ${tramite.operacion.empresa.nombre}.`}
          ejecutar={(gestora) => autorizarTramite(tramite.id, gestora, tramite.version)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'observar' && (
        <FormAccion
          titulo="Observar trámite"
          boton="Confirmar observación"
          pideMotivo="Indicá el motivo de la observación."
          ejecutar={(_, motivo) => cambiarEstado(tramite.id, 'observado', motivo, tramite.version)}
          onCerrar={cerrar}
        />
      )}
      {abierta === 'asignar' && (
        <FormAccion
          titulo="Asignar gestora"
          boton="Confirmar asignación"
          pideGestora
          gestoras={gestoras.filter((g) => g.id !== tramite.gestora_id)}
          pideMotivo="Indicá el motivo de la reasignación."
          ejecutar={(gestora, motivo) => reasignarGestora([tramite.id], gestora, motivo)}
          onCerrar={cerrar}
        />
      )}
    </div>
  )
}

interface PropsForm {
  titulo: string
  boton: string
  pideGestora?: boolean
  /** Si está, el motivo es obligatorio y este es el mensaje cuando falta. */
  pideMotivo?: string
  gestoras?: { id: string; nombre: string }[]
  aviso?: string
  ejecutar: (gestora: string, motivo: string) => Promise<void>
  onCerrar: () => void
}

function FormAccion({ titulo, boton, pideGestora, pideMotivo, gestoras = [], aviso, ejecutar, onCerrar }: PropsForm) {
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
    <Dialogo titulo={titulo} onCerrar={onCerrar}>
      <form onSubmit={confirmar} noValidate className="space-y-3">
        {aviso && <p className="text-sm">{aviso}</p>}
        {pideGestora && (
          <label className="block">
            <span className={CLASE_ETIQUETA}>Gestora</span>
            <select className={CLASE_CAMPO} value={gestora} onChange={(e) => setGestora(e.target.value)}>
              <option value="">Elegí la gestora</option>
              {gestoras.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        {pideMotivo && (
          <label className="block">
            <span className={CLASE_ETIQUETA}>Motivo</span>
            <textarea rows={3} className={CLASE_CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-alerta">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={CLASE_SECUNDARIO} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={CLASE_PRIMARIO} disabled={m.isPending}>
            {boton}
          </button>
        </div>
      </form>
    </Dialogo>
  )
}
