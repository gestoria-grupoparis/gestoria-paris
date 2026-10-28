import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { cargarCatalogos, LIMITE, listarTramites } from '../features/tramites/consultas'
import { Button, Cargando, EmptyState, ErrorState, PageHeader } from '../ui'
import { IconoMas } from '../ui/Iconos'
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

  // Se parte siempre de la URL actual: el updater de react-router recibe los parámetros del último
  // render y, si dos cambios llegan seguidos (cerrar detalle y tipear), el segundo pisaría al primero.
  const actuales = () => new URLSearchParams(window.location.search)
  const cambiarFiltros = (f: Filtros) => setParams(() => filtrosAURL(f, actuales()), { replace: true })
  const seleccionar = (id: string | null) =>
    setParams(() => {
      const n = actuales()
      if (id) n.set('t', id)
      else n.delete('t')
      return n
    })

  const n = lista.data?.length
  const conteo = n == null ? undefined : n === 1 ? '1 trámite' : `${n} trámites`
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <div className="min-w-0 flex-1 px-4 pt-5 pb-8 md:overflow-y-auto md:px-8 md:pt-8">
        <PageHeader
          rotulo="Operación"
          titulo="Trámites"
          descripcion={
            <span aria-live="polite">
              {conteo ? `${conteo} ${Object.values(filtros).some(Boolean) ? 'con los filtros aplicados' : 'en tu alcance'}.` : 'Altas, autorizaciones y seguimiento.'}
            </span>
          }
          acciones={
            <Button icono={<IconoMas className="size-[18px]" />} disabled={!catalogos.data} onClick={() => setAltaAbierta(true)}>
              Nuevo trámite
            </Button>
          }
        />
        <FiltrosTramites filtros={filtros} catalogos={catalogos.data} onCambiar={cambiarFiltros} />
        <div className="mt-5">
          {lista.isError ? (
            <ErrorState
              titulo="No se pudieron cargar los trámites"
              descripcion="Revisá la conexión y probá de nuevo."
              accion={
                <Button variante="secundario" tamano="sm" className="self-start" onClick={() => void lista.refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : !lista.data ? (
            <Cargando filas={6} etiqueta="Cargando trámites…" />
          ) : lista.data.length === 0 ? (
            <EmptyState
              titulo="Ningún trámite coincide"
              descripcion="Probá con otra búsqueda o limpiá los filtros."
              accion={
                Object.values(filtros).some(Boolean) ? (
                  <Button variante="secundario" tamano="sm" onClick={() => cambiarFiltros({})}>
                    Limpiar filtros
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TablaTramites
              filas={lista.data}
              seleccionado={seleccionado}
              onSeleccionar={seleccionar}
              nombreGestora={nombre}
              compacto={!!seleccionado}
              pie={lista.data.length >= LIMITE ? 'Se muestran los 500 más recientes. Afiná la búsqueda para ver otros.' : undefined}
            />
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
