import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { codigoError, mensajeError } from '../../lib/errores'
import { ErrorAccion } from './ErrorAccion'
import { Button, claseControl, Field, Input } from '../../ui'
import { cambiarEstado, editarTramite, type EdicionTramite, type TramiteDetalle } from './consultas'
import { Dialogo } from './Dialogo'

/**
 * Corrige cliente, cuenta, oferta y vehículo de un trámite en borrador u observado (editar_tramite,
 * con version: si otro lo tocó, VERSION_CONFLICTO). Un observado puede volver a borrador en el mismo paso.
 */
export function FormEdicion({ tramite, onCerrar }: { tramite: TramiteDetalle; onCerrar: () => void }) {
  const qc = useQueryClient()
  const observado = tramite.estado === 'observado'
  const [d, setD] = useState<EdicionTramite>({
    cliente: tramite.operacion.cliente_nombre,
    cuentaPersonal: tramite.operacion.cuenta_personal,
    oferta: tramite.operacion.oferta_ref,
    vehiculo: tramite.vehiculo_desc,
    dominio: tramite.dominio ?? '',
    chasis: tramite.chasis ?? '',
    motivo: '',
  })
  const [volver, setVolver] = useState(observado)
  const [error, setError] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)

  const m = useMutation({
    mutationFn: async () => {
      await editarTramite(tramite.id, tramite.version, { ...d, motivo: d.motivo.trim() })
      if (observado && volver) await cambiarEstado(tramite.id, 'borrador', d.motivo.trim(), tramite.version + 1)
    },
    onSuccess: onCerrar,
    onError: (e) => {
      setError(mensajeError(e))
      setConflicto(codigoError(e) === 'VERSION_CONFLICTO')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tramites'] }),
  })

  function guardar(e: FormEvent) {
    e.preventDefault()
    if (![d.cliente, d.cuentaPersonal, d.oferta, d.vehiculo].every((x) => x.trim()))
      return setError('Cliente, cuenta personal, oferta y vehículo son obligatorios.')
    setError(null)
    m.mutate()
  }

  const campo = (k: keyof EdicionTramite) => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }),
  })

  return (
    <Dialogo titulo="Editar datos del trámite" rotulo={tramite.numero} onCerrar={onCerrar} ancho="md:max-w-2xl">
      <form onSubmit={guardar} noValidate className="space-y-6">
        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-4">
          <legend className="rotulo col-span-2 mb-3">Cliente y operación</legend>
          <Field label="Cliente" className="col-span-2 sm:col-span-1">
            {(p) => <Input {...p} {...campo('cliente')} />}
          </Field>
          <Field label="Cuenta personal" className="col-span-2 sm:col-span-1">
            {(p) => <Input {...p} {...campo('cuentaPersonal')} />}
          </Field>
          <Field
            label="Oferta"
            className="col-span-2"
            ayuda={`Cliente y cuenta son de la venta: el cambio se ve en todos sus trámites. ${tramite.operacion.empresa.nombre}, ${tramite.operacion.sucursal.nombre}.`}
          >
            {(p) => <Input {...p} {...campo('oferta')} />}
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-4">
          <legend className="rotulo col-span-2 mb-3">Vehículo</legend>
          <Field label="Vehículo" className="col-span-2">
            {(p) => <Input {...p} {...campo('vehiculo')} />}
          </Field>
          <Field label="Dominio" className="col-span-2 sm:col-span-1">
            {(p) => <Input {...p} className="font-mono tracking-widest uppercase" placeholder="AA000AA" {...campo('dominio')} />}
          </Field>
          <Field label="Chasis" className="col-span-2 sm:col-span-1">
            {(p) => <Input {...p} className="font-mono uppercase" {...campo('chasis')} />}
          </Field>
        </fieldset>

        <div className="space-y-3 border-t border-linea pt-5">
          <Field label="Motivo de la corrección" ayuda="Opcional. Queda en el historial del trámite.">
            {(p) => <textarea {...p} rows={2} className={`${claseControl} h-auto py-2.5`} {...campo('motivo')} />}
          </Field>
          {observado && (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-4 py-3 ring-1 ring-linea has-[:checked]:bg-marca-suave has-[:checked]:ring-marca/30">
              <input type="checkbox" checked={volver} onChange={(e) => setVolver(e.target.checked)} className="size-5 accent-marca" />
              <span>
                <span className="block text-[14px] font-semibold">Volver a borrador al guardar</span>
                <span className="block text-[13px] text-tenue">Queda otra vez en "Para revisar" para autorizarlo.</span>
              </span>
            </label>
          )}
        </div>

        <ErrorAccion error={error} conflicto={conflicto} onRecargado={() => { setError(null); setConflicto(false) }} />
        <div className="flex flex-col-reverse gap-2 border-t border-linea pt-4 sm:flex-row sm:justify-end">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" cargando={m.isPending}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
