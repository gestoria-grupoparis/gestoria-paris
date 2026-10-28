import { useState } from 'react'
import { claseControl, cx } from '../../ui'
import { IconoBuscar, IconoCerrar, IconoFiltros } from '../../ui/Iconos'
import type { Catalogos } from './consultas'
import { ESTADOS, etiquetaEstado, VISTAS, type FiltrosTramites as Filtros } from './filtros'

interface Props {
  filtros: Filtros
  catalogos: Catalogos | undefined
  onCambiar: (f: Filtros) => void
}

const ETIQUETA = 'mb-1.5 block text-[12px] font-semibold text-tenue'

function Selector({
  etiqueta, valor, opciones, onCambiar, vacio = 'Todas',
}: {
  etiqueta: string
  valor?: string
  opciones: { id: string; nombre: string }[]
  onCambiar: (v: string) => void
  vacio?: string
}) {
  return (
    <label className="min-w-0">
      <span className={ETIQUETA}>{etiqueta}</span>
      <select className={cx(claseControl, valor && 'border-marca bg-marca-suave/40')} value={valor ?? ''} onChange={(e) => onCambiar(e.target.value)}>
        <option value="">{vacio}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    </label>
  )
}

type Avanzado = 'empresa' | 'provincia' | 'sucursal' | 'gestora' | 'tipo' | 'estado' | 'desde' | 'hasta'
const AVANZADOS: Avanzado[] = ['empresa', 'provincia', 'sucursal', 'gestora', 'tipo', 'estado', 'desde', 'hasta']

export function FiltrosTramites({ filtros, catalogos, onCambiar }: Props) {
  const set = (cambio: Partial<Filtros>) => onCambiar({ ...filtros, ...cambio })
  const activos = AVANZADOS.filter((k) => filtros[k])
  const [abierto, setAbierto] = useState(activos.length > 0)
  const provincias = [...new Set(catalogos?.sucursales.map((s) => s.provincia) ?? [])].sort()
  const sucursales = (catalogos?.sucursales ?? [])
    .filter((s) => !filtros.provincia || s.provincia === filtros.provincia)
    .map((s) => ({ id: s.id, nombre: `${s.nombre} (${s.provincia})` }))
  const gestoras = (catalogos?.perfiles ?? []).filter((p) => p.rol === 'gestora')
  const hayFiltros = Object.values(filtros).some(Boolean)

  const nombreDe = (k: Avanzado): string => {
    const v = filtros[k] ?? ''
    switch (k) {
      case 'empresa': return catalogos?.empresas.find((x) => x.id === v)?.nombre ?? v
      case 'sucursal': return catalogos?.sucursales.find((x) => x.id === v)?.nombre ?? v
      case 'gestora': return catalogos?.perfiles.find((x) => x.id === v)?.nombre ?? v
      case 'tipo': return catalogos?.tipos.find((x) => x.id === v)?.nombre ?? v
      case 'estado': return etiquetaEstado(v)
      case 'desde': return `Desde ${v.split('-').reverse().join('/')}`
      case 'hasta': return `Hasta ${v.split('-').reverse().join('/')}`
      default: return v
    }
  }

  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-hundido p-1" role="group" aria-label="Vistas guardadas">
          {VISTAS.map((v) => {
            const activa = filtros.vista === v.id
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={activa}
                onClick={() => set({ vista: activa ? undefined : v.id })}
                className={cx(
                  'h-10 rounded-md px-3.5 text-[14px] font-semibold whitespace-nowrap transition-colors',
                  activa ? 'bg-superficie text-marca shadow-tarjeta' : 'text-tenue hover:text-tinta',
                  v.id === 'sin_fondos' && activa && 'text-sinfondos',
                )}
              >
                {v.etiqueta}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar</span>
          <IconoBuscar className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-tenue" />
          <input
            type="search"
            aria-label="Buscar"
            placeholder="Buscar por cliente, cuenta, oferta o dominio"
            className={cx(claseControl, 'h-12 pl-10 text-[15px] shadow-tarjeta')}
            value={filtros.q ?? ''}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        <button
          type="button"
          aria-expanded={abierto}
          aria-label={activos.length ? `Filtros (${activos.length} activos)` : 'Filtros'}
          aria-controls="filtros-avanzados"
          onClick={() => setAbierto(!abierto)}
          className={cx(
            'inline-flex h-12 shrink-0 items-center gap-2 rounded-md px-4 text-[15px] font-semibold ring-1 ring-inset transition-colors',
            abierto || activos.length ? 'bg-marca-suave text-marca ring-marca/30' : 'bg-superficie text-tinta ring-linea-fuerte hover:bg-hundido',
          )}
        >
          <IconoFiltros className="size-[18px]" />
          <span className="hidden sm:inline">Filtros</span>
          {activos.length > 0 && (
            <span aria-hidden className="cifra grid size-5 place-items-center rounded-full bg-marca text-[11px] text-superficie">{activos.length}</span>
          )}
        </button>
      </div>

      {abierto && (
        <div id="filtros-avanzados" className="grid grid-cols-2 gap-3 rounded-lg bg-superficie p-4 shadow-tarjeta ring-1 ring-linea sm:grid-cols-4 xl:grid-cols-8">
          <Selector etiqueta="Razón social" valor={filtros.empresa} opciones={catalogos?.empresas ?? []} onCambiar={(v) => set({ empresa: v })} />
          <Selector
            etiqueta="Provincia"
            valor={filtros.provincia}
            opciones={provincias.map((p) => ({ id: p, nombre: p }))}
            onCambiar={(v) => set({ provincia: v, sucursal: undefined })}
          />
          <Selector etiqueta="Sucursal" valor={filtros.sucursal} opciones={sucursales} onCambiar={(v) => set({ sucursal: v })} />
          <Selector etiqueta="Gestora" valor={filtros.gestora} opciones={gestoras} onCambiar={(v) => set({ gestora: v })} />
          <Selector etiqueta="Tipo" vacio="Todos" valor={filtros.tipo} opciones={catalogos?.tipos ?? []} onCambiar={(v) => set({ tipo: v })} />
          <Selector
            etiqueta="Estado"
            vacio="Todos"
            valor={filtros.estado}
            opciones={ESTADOS.map((e) => ({ id: e.id, nombre: e.etiqueta }))}
            onCambiar={(v) => set({ estado: v })}
          />
          <label>
            <span className={ETIQUETA}>Desde</span>
            <input type="date" className={claseControl} value={filtros.desde ?? ''} onChange={(e) => set({ desde: e.target.value })} />
          </label>
          <label>
            <span className={ETIQUETA}>Hasta</span>
            <input type="date" className={claseControl} value={filtros.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value })} />
          </label>
        </div>
      )}

      {(activos.length > 0 || hayFiltros) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activos.map((k) => (
            <button
              key={k}
              type="button"
              aria-label={`Quitar filtro ${nombreDe(k)}`}
              onClick={() => set(k === 'provincia' ? { provincia: undefined, sucursal: undefined } : { [k]: undefined })}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-marca-suave pr-2 pl-3 text-[13px] font-semibold text-marca-tinta hover:bg-marca-suave/70"
            >
              {nombreDe(k)}
              <IconoCerrar className="size-3.5" />
            </button>
          ))}
          {hayFiltros && (
            <button type="button" onClick={() => onCambiar({})} className="h-8 px-2 text-[13px] font-semibold text-tenue underline-offset-2 hover:text-tinta hover:underline">
              Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  )
}
