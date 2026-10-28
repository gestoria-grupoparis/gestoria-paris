import { Chip, TONO_ESTADO, type TonoChip } from '../../ui'
import { etiquetaEstado, SITUACIONES } from './filtros'

export function EstadoChip({ estado, testId, grande }: { estado: string; testId?: string; grande?: boolean }) {
  return (
    <Chip tono={TONO_ESTADO[estado] ?? 'neutro'} className={grande ? 'h-7 px-3 text-[13px]' : undefined}>
      <span data-testid={testId}>{etiquetaEstado(estado)}</span>
    </Chip>
  )
}

const TONO_SITUACION: Record<string, TonoChip> = {
  pagado: 'disponible',
  sin_fondos: 'sinfondos',
  comprometido: 'comprometido',
  pagado_parcial: 'info',
  sin_presupuesto: 'neutro',
}

/** Situación financiera del trámite como chip; "no aplica" se muestra como raya. */
export function SituacionChip({ situacion }: { situacion: string | undefined }) {
  const s = situacion ?? 'no_aplica'
  if (s === 'no_aplica') return <span className="text-tenue">—</span>
  return <Chip tono={TONO_SITUACION[s] ?? 'neutro'}>{SITUACIONES[s] ?? s}</Chip>
}
