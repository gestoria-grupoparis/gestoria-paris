import type { Catalogos } from './consultas'
import { CLASE_CAMPO, CLASE_ETIQUETA } from './Dialogo'
import { ESTADOS, VISTAS, type FiltrosTramites as Filtros } from './filtros'

interface Props {
  filtros: Filtros
  catalogos: Catalogos | undefined
  onCambiar: (f: Filtros) => void
}

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
      <span className={CLASE_ETIQUETA}>{etiqueta}</span>
      <select className={CLASE_CAMPO} value={valor ?? ''} onChange={(e) => onCambiar(e.target.value)}>
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

export function FiltrosTramites({ filtros, catalogos, onCambiar }: Props) {
  const set = (cambio: Partial<Filtros>) => onCambiar({ ...filtros, ...cambio })
  const provincias = [...new Set(catalogos?.sucursales.map((s) => s.provincia) ?? [])].sort()
  const sucursales = (catalogos?.sucursales ?? [])
    .filter((s) => !filtros.provincia || s.provincia === filtros.provincia)
    .map((s) => ({ id: s.id, nombre: `${s.nombre} (${s.provincia})` }))
  const gestoras = (catalogos?.perfiles ?? []).filter((p) => p.rol === 'gestora')
  const hayFiltros = Object.values(filtros).some(Boolean)

  return (
    <div className="space-y-2 border-b border-linea bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vistas guardadas">
        {VISTAS.map((v) => {
          const activa = filtros.vista === v.id
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={activa}
              onClick={() => set({ vista: activa ? undefined : v.id })}
              className={`border px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-marca ${
                activa ? 'border-marca bg-marca text-white' : 'border-linea bg-white hover:bg-fondo'
              }`}
            >
              {v.etiqueta}
            </button>
          )
        })}
        {hayFiltros && (
          <button type="button" onClick={() => onCambiar({})} className="ml-auto text-xs text-tenue underline">
            Limpiar filtros
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-10">
        <label className="col-span-2 sm:col-span-4 lg:col-span-2">
          <span className={CLASE_ETIQUETA}>Buscar</span>
          <input
            type="search"
            aria-label="Buscar"
            placeholder="Cliente, cuenta, oferta o dominio"
            className={CLASE_CAMPO}
            value={filtros.q ?? ''}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
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
        <div className="col-span-2 grid grid-cols-2 gap-1 ">
          <label>
            <span className={CLASE_ETIQUETA}>Desde</span>
            <input type="date" className={CLASE_CAMPO} value={filtros.desde ?? ''} onChange={(e) => set({ desde: e.target.value })} />
          </label>
          <label>
            <span className={CLASE_ETIQUETA}>Hasta</span>
            <input type="date" className={CLASE_CAMPO} value={filtros.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value })} />
          </label>
        </div>
      </div>
    </div>
  )
}
