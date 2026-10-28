import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMemo } from 'react'
import { formatearPesos } from '../../lib/dinero'
import { celdaMonto, cx, DataTable, Patente } from '../../ui'
import { IconoChevron } from '../../ui/Iconos'
import type { TramiteFila } from './consultas'
import { EstadoChip, SituacionChip } from './EstadoChip'
import { formatearFecha, SITUACIONES } from './filtros'

const features = tableFeatures({})
const col = createColumnHelper<typeof features, TramiteFila>()

const pesos = (v: string | null | undefined) => (v == null ? '—' : formatearPesos(v))
const OCULTAS = ['empresa', 'gestora']
type Meta = { numero?: boolean; clase?: string }

// Columnas de la sección G.1 del spec, agrupadas de a dos datos por celda para que la fila se lea de un vistazo.
function columnas(nombreGestora: (id: string | null) => string) {
  return col.columns([
    col.accessor('numero', {
      header: 'Trámite',
      cell: (c) => (
        <div className="leading-tight">
          <div className="cifra font-semibold whitespace-nowrap text-tinta">{c.getValue()}</div>
          <div className="mt-0.5 max-w-[11rem] truncate text-[12px] text-tenue">{c.row.original.tipo.nombre}</div>
        </div>
      ),
    }),
    col.accessor((t) => t.operacion.cliente_nombre, {
      id: 'cliente',
      header: 'Cliente',
      cell: (c) => (
        <div className="leading-tight">
          <div className="max-w-[14rem] truncate font-medium">{c.getValue()}</div>
          <div className="mt-0.5 text-[12px] whitespace-nowrap text-tenue">Oferta {c.row.original.operacion.oferta_ref}</div>
        </div>
      ),
    }),
    col.accessor((t) => t.dominio ?? '', {
      id: 'dominio',
      header: 'Vehículo',
      cell: (c) => (
        <div className="leading-tight">
          <div className="max-w-[12rem] truncate">{c.row.original.vehiculo_desc}</div>
          <div className="mt-1">{c.getValue() ? <Patente dominio={c.getValue()} /> : <span className="text-[12px] text-tenue">Sin dominio</span>}</div>
        </div>
      ),
    }),
    col.accessor((t) => t.operacion.empresa.nombre, {
      id: 'empresa',
      header: 'Razón social',
      cell: (c) => (
        <div className="leading-tight whitespace-nowrap">
          <div>{c.getValue()}</div>
          <div className="mt-0.5 text-[12px] text-tenue">
            {c.row.original.operacion.sucursal.nombre} · {formatearFecha(c.row.original.created_at)}
          </div>
        </div>
      ),
    }),
    col.accessor((t) => nombreGestora(t.gestora_id), {
      id: 'gestora',
      header: 'Gestora',
      cell: (c) =>
        c.row.original.gestora_id ? <span className="whitespace-nowrap">{c.getValue()}</span> : <span className="text-tenue">Sin asignar</span>,
    }),
    col.accessor('estado', {
      header: 'Estado',
      cell: (c) => {
        const sit = c.row.original.finanzas?.situacion
        return (
          <div className="flex flex-col items-start gap-1">
            <EstadoChip estado={c.getValue()} />
            {sit && sit !== 'no_aplica' && (
              <span className={cx('pl-1 text-[12px] whitespace-nowrap', sit === 'sin_fondos' ? 'font-semibold text-sinfondos' : 'text-tenue')}>
                {SITUACIONES[sit] ?? sit}
              </span>
            )}
          </div>
        )
      },
    }),
    col.accessor((t) => pesos(t.finanzas?.presupuesto), {
      id: 'presupuesto',
      header: 'Presupuesto',
      meta: { numero: true },
      cell: (c) => (
        <div className="leading-tight">
          <div className={c.row.original.finanzas?.presupuesto == null ? 'font-normal text-tenue' : ''}>{c.getValue()}</div>
          {c.row.original.finanzas?.presupuesto != null && (
            <div className="mt-0.5 text-[12px] font-normal text-tenue">Pagado {pesos(c.row.original.finanzas?.pagado)}</div>
          )}
        </div>
      ),
    }),
  ])
}

interface Props {
  filas: TramiteFila[]
  seleccionado: string | null
  onSeleccionar: (id: string) => void
  nombreGestora: (id: string | null) => string
  pie?: string
  /** Con el detalle abierto se ocultan columnas secundarias para que la tabla no se corte. */
  compacto?: boolean
}

export function TablaTramites({ filas, seleccionado, onSeleccionar, nombreGestora, pie, compacto }: Props) {
  const columns = useMemo(() => columnas(nombreGestora), [nombreGestora])
  const table = useTable<typeof features, TramiteFila>({
    features,
    columns,
    data: filas,
    getRowId: (t) => t.id,
  })
  return (
    <>
      {/* Escritorio: tabla */}
      <div className="hidden md:block">
        <DataTable aria-label="Trámites" pie={pie}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.filter((h) => !(compacto && OCULTAS.includes(h.column.id))).map((h) => (
                  <th key={h.id} scope="col" className={cx('whitespace-nowrap', (h.column.columnDef.meta as Meta | undefined)?.numero && 'text-right!')}>
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
                className={cx(
                  'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca',
                  r.original.finanzas?.situacion === 'sin_fondos' && '[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-sinfondos)]',
                  r.id === seleccionado && '[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-marca)]',
                )}
              >
                {r.getAllCells().filter((c) => !(compacto && OCULTAS.includes(c.column.id))).map((c) => (
                  <td key={c.id} className={cx('h-16!', (c.column.columnDef.meta as Meta | undefined)?.numero && celdaMonto)}>
                    <table.FlexRender cell={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      {/* Teléfono: tarjetas */}
      <ul aria-label="Trámites" className="space-y-2.5 md:hidden">
        {filas.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSeleccionar(t.id)}
              className={cx(
                'flex w-full items-stretch gap-3 rounded-lg bg-superficie p-4 text-left shadow-tarjeta ring-1 ring-linea',
                t.finanzas?.situacion === 'sin_fondos' && 'ring-sinfondos/40',
                t.id === seleccionado && 'ring-2 ring-marca',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="cifra text-[13px] font-semibold text-tenue">{t.numero}</span>
                  <EstadoChip estado={t.estado} />
                </div>
                <div className="mt-1.5 truncate font-display text-[17px] leading-tight font-semibold">{t.operacion.cliente_nombre}</div>
                <div className="mt-1 flex items-center gap-2 text-[13px] text-tenue">
                  <span className="truncate">{t.vehiculo_desc}</span>
                  {t.dominio && <Patente dominio={t.dominio} className="shrink-0" />}
                </div>
                <div className="mt-3 flex items-end justify-between gap-2 border-t border-linea pt-2.5">
                  <div className="min-w-0 text-[12px] leading-tight text-tenue">
                    <div className="truncate">{t.tipo.nombre}</div>
                    <div className="truncate">
                      {t.operacion.empresa.nombre} · {nombreGestora(t.gestora_id) === '—' ? 'Sin gestora' : nombreGestora(t.gestora_id)}
                    </div>
                  </div>
                  <div className="text-right">
                    {t.finanzas?.presupuesto != null ? (
                      <div className="cifra font-display text-[16px] font-semibold">{pesos(t.finanzas.presupuesto)}</div>
                    ) : (
                      <div className="text-[12px] text-tenue">Sin presupuesto</div>
                    )}
                    {t.finanzas?.situacion && !['no_aplica', 'sin_presupuesto'].includes(t.finanzas.situacion) && (
                      <SituacionChip situacion={t.finanzas.situacion} />
                    )}
                  </div>
                </div>
              </div>
              <IconoChevron className="size-4 self-center text-tenue" />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
