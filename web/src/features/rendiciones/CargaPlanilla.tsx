import type { RendicionDetalle } from './consultas'
import { EmptyState } from '../../ui'

export function CargaPlanilla(_p: { rendicion: RendicionDetalle; editable: boolean }) {
  return <EmptyState titulo="Próximamente" />
}
