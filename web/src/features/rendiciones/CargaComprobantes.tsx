import type { RendicionDetalle } from './consultas'
import { EmptyState } from '../../ui'

export function CargaComprobantes(_p: { rendicion: RendicionDetalle; editable: boolean; filaFoco: string | null }) {
  return <EmptyState titulo="Próximamente" />
}
