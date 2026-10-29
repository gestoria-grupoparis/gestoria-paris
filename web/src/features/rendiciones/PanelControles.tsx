import type { RendicionDetalle } from './consultas'
import { EmptyState } from '../../ui'

export function PanelControles(_p: { rendicion: RendicionDetalle; onIr: (v: 'planilla' | 'comprobantes' | 'controles', fila?: string) => void }) {
  return <EmptyState titulo="Próximamente" />
}
