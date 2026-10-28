import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '../../ui'
import { historial, type Evento } from './consultas'
import { etiquetaEstado, formatearFechaHora } from './filtros'

export const MARCAS: Record<string, string> = {
  legajo_recibido: 'Legajo recibido',
  firmado: 'Firmado por gerencia',
  recibido_admin: 'Recibido por administración',
  entregado: 'Entregado',
  retirado: 'Retirado',
}

function describir(e: Evento, nombre: (id: string | null) => string): string {
  if (e.entidad === 'tramite_marcas') return `Marca: ${MARCAS[e.marca ?? ''] ?? e.marca}`
  if (e.accion === 'insert') return 'Alta del trámite'
  const partes: string[] = []
  if (e.estado_antes !== e.estado_despues)
    partes.push(`${etiquetaEstado(e.estado_antes)} → ${etiquetaEstado(e.estado_despues)}`)
  if (e.gestora_antes !== e.gestora_despues) partes.push(`Gestora: ${nombre(e.gestora_despues)}`)
  return partes.join('. ') || 'Modificación'
}

function tono(e: Evento): string {
  if (e.entidad === 'tramite_marcas') return 'bg-laton'
  if (e.estado_despues && ['rechazado', 'cancelado'].includes(e.estado_despues)) return 'bg-sinfondos'
  if (e.estado_despues && ['observado', 'suspendido'].includes(e.estado_despues)) return 'bg-comprometido'
  return 'bg-marca'
}

export function HistorialEventos({ tramiteId, nombre }: { tramiteId: string; nombre: (id: string | null) => string }) {
  const q = useQuery({ queryKey: ['tramites', 'historial', tramiteId], queryFn: () => historial(tramiteId) })
  if (q.isPending)
    return (
      <div role="status" className="space-y-2">
        <span className="sr-only">Cargando historial…</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-10 w-10/12" />
      </div>
    )
  if (q.isError)
    return (
      <p role="alert" className="text-sm text-sinfondos">
        No se pudo cargar el historial.
      </p>
    )
  if (!q.data.length) return <p className="text-sm text-tenue">Sin cambios registrados.</p>
  return (
    <ol aria-label="Historial" className="relative">
      {q.data.map((e, i) => (
        <li key={e.id} className="relative pb-4 pl-6 last:pb-0">
          {i < q.data.length - 1 && <span aria-hidden className="absolute top-3 bottom-0 left-[5px] w-px bg-linea-fuerte" />}
          <span aria-hidden className={`absolute top-1.5 left-0 size-[11px] rounded-full ring-[3px] ring-superficie ${tono(e)}`} />
          <div className="text-[14px] font-semibold text-tinta">{describir(e, nombre)}</div>
          {e.motivo && <div className="mt-0.5 rounded-sm bg-hundido px-2.5 py-1.5 text-[13px]">Motivo: {e.motivo}</div>}
          <div className="mt-0.5 text-[13px] text-tenue">
            {nombre(e.actor_id)}, <time dateTime={e.at}>{formatearFechaHora(e.at)}</time>
          </div>
        </li>
      ))}
    </ol>
  )
}
