import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { formatearPesos, parsearPesos } from '../../lib/dinero'
import { mensajeError } from '../../lib/errores'
import { Button, claseControl, Field, Input } from '../../ui'
import { registrarReintegro, type TramiteDetalle } from './consultas'
import { Dialogo } from './Dialogo'
import { hoyEnBuenosAires } from './filtros'

/**
 * Reintegro de fondos de un trámite a la cuenta Habitualista de su razón social (caso F): los pagos
 * quedan como ocurrieron y el reintegro suma al saldo. Una clave por apertura: reintentar no duplica.
 */
export function FormReintegro({ tramite, onCerrar }: { tramite: TramiteDetalle; onCerrar: () => void }) {
  const qc = useQueryClient()
  const [idem] = useState(() => crypto.randomUUID())
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires())
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: (cents: bigint) => registrarReintegro(idem, tramite.id, cents, fecha, motivo.trim()),
    onSuccess: onCerrar,
    onError: (e) => setError(mensajeError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tramites'] }),
  })

  function guardar(e: FormEvent) {
    e.preventDefault()
    let cents: bigint
    try {
      cents = parsearPesos(importe)
    } catch (err) {
      return setError((err as Error).message)
    }
    if (cents <= 0n) return setError('El importe del reintegro tiene que ser mayor a cero.')
    if (!fecha) return setError('Indicá la fecha del reintegro.')
    if (!motivo.trim()) return setError('Indicá el motivo del reintegro.')
    setError(null)
    m.mutate(cents)
  }

  return (
    <Dialogo titulo="Registrar reintegro" rotulo={`Trámite ${tramite.numero}`} onCerrar={onCerrar}>
      <form onSubmit={guardar} noValidate className="space-y-4">
        <div className="flex items-end justify-between gap-3 rounded-lg bg-noche px-4 py-3 text-superficie">
          <div>
            <div className="text-[12px] font-medium text-white/60">Pagado en el trámite</div>
            <strong className="cifra mt-0.5 block font-display text-[24px] leading-tight font-semibold">
              {tramite.finanzas?.pagado ? formatearPesos(tramite.finanzas.pagado) : '—'}
            </strong>
          </div>
          <span className="pb-1 text-right text-[12px] text-superficie/70">Vuelve a {tramite.operacion.empresa.nombre}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Importe" className="col-span-2 sm:col-span-1">
            {(p) => (
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tenue">$</span>
                <Input {...p} inputMode="decimal" autoComplete="off" placeholder="0" value={importe}
                  onChange={(e) => setImporte(e.target.value)} className="cifra h-12 pl-7 text-right text-[17px] font-semibold" />
              </div>
            )}
          </Field>
          <Field label="Fecha" className="col-span-2 sm:col-span-1">
            {(p) => <Input {...p} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-12" />}
          </Field>
        </div>
        <Field label="Motivo" ayuda="Por ejemplo: el registro devolvió el arancel de una venta caída.">
          {(p) => <textarea {...p} rows={2} className={`${claseControl} h-auto py-2.5`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" cargando={m.isPending}>
            Guardar reintegro
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
