import { ESTADOS, etiquetaEstado } from './filtros'

export function EstadoChip({ estado, testId }: { estado: string; testId?: string }) {
  const chip = ESTADOS.find((e) => e.id === estado)?.chip ?? 'bg-slate-100 text-slate-800 ring-slate-300'
  return (
    <span data-testid={testId} className={`inline-block whitespace-nowrap px-1.5 py-px text-xs font-medium ring-1 ring-inset ${chip}`}>
      {etiquetaEstado(estado)}
    </span>
  )
}
