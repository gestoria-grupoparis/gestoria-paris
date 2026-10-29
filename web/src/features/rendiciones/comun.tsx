// Piezas compartidas de la pantalla de rendiciones.
import { Chip, cx, type TonoChip } from '../../ui'
import type { ControlesRendicion, EstadoRendicion } from './consultas'

export const ESTADO_RENDICION: Record<EstadoRendicion, { etiqueta: string; tono: TonoChip }> = {
  borrador: { etiqueta: 'Borrador', tono: 'neutro' },
  enviada: { etiqueta: 'En control', tono: 'info' },
  observada: { etiqueta: 'Observada', tono: 'comprometido' },
  aprobada: { etiqueta: 'Aprobada', tono: 'disponible' },
}

export function ChipRendicion({ estado }: { estado: EstadoRendicion }) {
  const e = ESTADO_RENDICION[estado]
  return <Chip tono={e.tono}>{e.etiqueta}</Chip>
}

const NOMBRES_CONTROL = [
  ['importes', 'Importes'],
  ['autorizados', 'Autorizados'],
  ['honorarios', 'Honorarios'],
] as const

/** Tres puntos (importes, autorizados, honorarios) con su texto accesible: nunca solo color. */
export function Semaforo({ controles }: { controles: ControlesRendicion | null }) {
  if (!controles) return <span className="text-[12px] text-tenue">Sin calcular</span>
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={NOMBRES_CONTROL.map(([k, n]) => `${n}: ${controles[k].ok ? 'ok' : 'con diferencias'}`).join(', ')}>
      {NOMBRES_CONTROL.map(([k, n]) => (
        <span
          key={k}
          title={`${n}: ${controles[k].ok ? 'ok' : 'con diferencias'}`}
          className={cx('size-2.5 rounded-full ring-1 ring-inset', controles[k].ok ? 'bg-disponible ring-disponible/40' : 'bg-sinfondos ring-sinfondos/40')}
        />
      ))}
    </span>
  )
}

export const puedeEditar = (estado: EstadoRendicion) => estado === 'borrador' || estado === 'observada'
