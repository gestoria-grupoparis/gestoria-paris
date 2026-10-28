import { useQuery } from '@tanstack/react-query'
import { historial, type Evento } from './consultas'
import { etiquetaEstado, formatearFechaHora } from './filtros'

export const MARCAS: Record<string, string> = {
  legajo_recibido: 'Legajo recibido',
  firmado: 'Firmado',
  entregado: 'Entregado',
  retirado: 'Retirado',
  recibido_admin: 'Recibido por administración',
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

export function HistorialEventos({ tramiteId, nombre }: { tramiteId: string; nombre: (id: string | null) => string }) {
  const q = useQuery({ queryKey: ['tramites', 'historial', tramiteId], queryFn: () => historial(tramiteId) })
  if (q.isPending) return <p className="text-xs text-tenue">Cargando historial…</p>
  if (q.isError)
    return (
      <p role="alert" className="text-xs text-alerta">
        No se pudo cargar el historial.
      </p>
    )
  if (!q.data.length) return <p className="text-xs text-tenue">Sin cambios registrados.</p>
  return (
    <ol aria-label="Historial" className="space-y-2">
      {q.data.map((e) => (
        <li key={e.id} className="border-l-2 border-linea pl-2 text-xs">
          <div className="font-medium">{describir(e, nombre)}</div>
          {e.motivo && <div>Motivo: {e.motivo}</div>}
          <div className="text-tenue">
            {nombre(e.actor_id)}, <time dateTime={e.at}>{formatearFechaHora(e.at)}</time>
          </div>
        </li>
      ))}
    </ol>
  )
}
