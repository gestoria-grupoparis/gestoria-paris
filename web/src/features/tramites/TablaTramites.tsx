import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMemo } from 'react'
import { formatearPesos } from '../../lib/dinero'
import type { TramiteFila } from './consultas'
import { EstadoChip } from './EstadoChip'
import { formatearFecha, SITUACIONES } from './filtros'

const features = tableFeatures({})
const col = createColumnHelper<typeof features, TramiteFila>()

const pesos = (v: string | null | undefined) => (v == null ? '—' : formatearPesos(v))

// Columnas de la sección G.1 del spec, en ese orden.
function columnas(nombreGestora: (id: string | null) => string) {
  return col.columns([
    col.accessor('numero', { header: 'N°' }),
    col.accessor('created_at', { header: 'Ingreso', cell: (c) => formatearFecha(c.getValue()) }),
    col.accessor((t) => t.tipo.nombre, { id: 'tipo', header: 'Tipo' }),
    col.accessor((t) => t.operacion.empresa.nombre, { id: 'empresa', header: 'Razón social' }),
    col.accessor((t) => t.operacion.sucursal.nombre, { id: 'sucursal', header: 'Sucursal' }),
    col.accessor((t) => t.operacion.cliente_nombre, { id: 'cliente', header: 'Cliente' }),
    col.accessor((t) => t.operacion.oferta_ref, { id: 'oferta', header: 'Oferta' }),
    col.accessor((t) => t.dominio ?? '', { id: 'dominio', header: 'Dominio' }),
    col.accessor((t) => nombreGestora(t.gestora_id), { id: 'gestora', header: 'Gestora' }),
    col.accessor('estado', { header: 'Estado', cell: (c) => <EstadoChip estado={c.getValue()} /> }),
    col.accessor((t) => pesos(t.finanzas?.presupuesto), { id: 'presupuesto', header: 'Presupuesto', meta: { numero: true } }),
    col.accessor((t) => pesos(t.finanzas?.pagado), { id: 'pagado', header: 'Pagado', meta: { numero: true } }),
    col.accessor((t) => t.finanzas?.situacion ?? 'no_aplica', {
      id: 'situacion',
      header: 'Situación financiera',
      cell: (c) => (
        <span className={c.getValue() === 'sin_fondos' ? 'font-semibold text-alerta' : ''}>
          {SITUACIONES[c.getValue()] ?? c.getValue()}
        </span>
      ),
    }),
  ])
}

interface Props {
  filas: TramiteFila[]
  seleccionado: string | null
  onSeleccionar: (id: string) => void
  nombreGestora: (id: string | null) => string
}

export function TablaTramites({ filas, seleccionado, onSeleccionar, nombreGestora }: Props) {
  const columns = useMemo(() => columnas(nombreGestora), [nombreGestora])
  const table = useTable<typeof features, TramiteFila>({
    features,
    columns,
    data: filas,
    getRowId: (t) => t.id,
  })
  return (
    <div className="overflow-x-auto border-y border-linea bg-white md:border">
      <table aria-label="Trámites" className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-fondo text-left text-tenue">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  scope="col"
                  className={`border-b border-linea px-2 py-1.5 font-medium whitespace-nowrap ${
                    (h.column.columnDef.meta as { numero?: boolean } | undefined)?.numero ? 'text-right' : ''
                  }`}
                >
                  <table.FlexRender header={h} />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSeleccionar(r.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSeleccionar(r.id))}
              tabIndex={0}
              aria-selected={r.id === seleccionado}
              className={`cursor-pointer border-b border-linea/70 last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca ${
                r.id === seleccionado ? 'bg-marca/10' : 'hover:bg-fondo'
              }`}
            >
              {r.getAllCells().map((c) => (
                <td
                  key={c.id}
                  className={`px-2 py-1 whitespace-nowrap ${
                    (c.column.columnDef.meta as { numero?: boolean } | undefined)?.numero ? 'text-right' : ''
                  } ${c.column.id === 'numero' ? 'font-semibold' : ''}`}
                >
                  <table.FlexRender cell={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
