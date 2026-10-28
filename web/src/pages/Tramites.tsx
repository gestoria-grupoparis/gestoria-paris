import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { cargarCatalogos, listarTramites } from '../features/tramites/consultas'
import { CLASE_PRIMARIO } from '../features/tramites/Dialogo'
import { filtrosAURL, filtrosDesdeURL, type FiltrosTramites as Filtros } from '../features/tramites/filtros'
import { FiltrosTramites } from '../features/tramites/FiltrosTramites'
import { FormAlta } from '../features/tramites/FormAlta'
import { PanelDetalle } from '../features/tramites/PanelDetalle'
import { TablaTramites } from '../features/tramites/TablaTramites'

/** Cualquier cambio en trámites, presupuestos o movimientos refresca la tabla y el detalle. */
function useTramitesEnVivo() {
  const qc = useQueryClient()
  useEffect(() => {
    const invalidar = () => qc.invalidateQueries({ queryKey: ['tramites'] })
    const canal = supabase.channel('tramites-pantalla')
    for (const table of ['tramites', 'presupuestos', 'movimientos'])
      canal.on('postgres_changes', { event: '*', schema: 'public', table }, invalidar)
    canal.subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [qc])
}

export function Tramites() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => filtrosDesdeURL(params), [params])
  const seleccionado = params.get('t')
  const [altaAbierta, setAltaAbierta] = useState(false)
  const qc = useQueryClient()
  useTramitesEnVivo()

  const catalogos = useQuery({ queryKey: ['catalogos'], queryFn: cargarCatalogos, staleTime: 5 * 60_000 })
  const sucursalesDeProvincia = filtros.provincia
    ? catalogos.data?.sucursales.filter((s) => s.provincia === filtros.provincia).map((s) => s.id)
    : undefined
  const lista = useQuery({
    queryKey: ['tramites', 'lista', filtros, sucursalesDeProvincia],
    queryFn: () => listarTramites(filtros, sucursalesDeProvincia),
    enabled: !filtros.provincia || catalogos.isSuccess,
    placeholderData: (previo) => previo,
  })

  const nombres = useMemo(
    () => new Map((catalogos.data?.perfiles ?? []).map((p) => [p.id, p.nombre])),
    [catalogos.data],
  )
  const nombre = useCallback((id: string | null) => (id ? (nombres.get(id) ?? 'Usuario desconocido') : '—'), [nombres])

  const cambiarFiltros = (f: Filtros) => setParams((p) => filtrosAURL(f, p), { replace: true })
  const seleccionar = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.set('t', id)
      else n.delete('t')
      return n
    })

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h1 className="text-lg font-semibold">Trámites</h1>
          <div className="flex items-center gap-3">
            {lista.data && (
              <span className="text-xs text-tenue" aria-live="polite">
                {lista.data.length === 1 ? '1 trámite' : `${lista.data.length} trámites`}
              </span>
            )}
            <button
              type="button"
              className={CLASE_PRIMARIO}
              disabled={!catalogos.data}
              onClick={() => setAltaAbierta(true)}
            >
              Nuevo trámite
            </button>
          </div>
        </header>
        <FiltrosTramites filtros={filtros} catalogos={catalogos.data} onCambiar={cambiarFiltros} />
        <div className="min-h-0 flex-1 overflow-auto md:p-3">
          {lista.isError ? (
            <p role="alert" className="p-4 text-sm text-alerta">
              No se pudieron cargar los trámites.{' '}
              <button type="button" className="underline" onClick={() => void lista.refetch()}>
                Reintentar
              </button>
            </p>
          ) : !lista.data ? (
            <p className="p-4 text-sm text-tenue">Cargando trámites…</p>
          ) : lista.data.length === 0 ? (
            <p className="p-4 text-sm text-tenue">Ningún trámite coincide con los filtros. Probá con otra búsqueda o limpiá los filtros.</p>
          ) : (
            <TablaTramites filas={lista.data} seleccionado={seleccionado} onSeleccionar={seleccionar} nombreGestora={nombre} />
          )}
        </div>
      </div>
      {seleccionado && catalogos.data && (
        <PanelDetalle id={seleccionado} catalogos={catalogos.data} nombre={nombre} onCerrar={() => seleccionar(null)} />
      )}
      {altaAbierta && catalogos.data && (
        <FormAlta
          catalogos={catalogos.data}
          onCerrar={() => setAltaAbierta(false)}
          onCreado={(id) => {
            setAltaAbierta(false)
            void qc.invalidateQueries({ queryKey: ['tramites'] })
            seleccionar(id)
          }}
        />
      )}
    </div>
  )
}
