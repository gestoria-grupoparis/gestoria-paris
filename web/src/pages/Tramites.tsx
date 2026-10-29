import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { cargarCatalogos, LIMITE, listarTramites } from '../features/tramites/consultas'
import { Button, Cargando, EmptyState, ErrorState, PageHeader } from '../ui'
import { IconoCerrar, IconoCheck, IconoDescarga, IconoMas, IconoUsuario } from '../ui/Iconos'
import { FormAccion } from '../features/tramites/AccionesTramite'
import { reasignarGestora } from '../features/tramites/consultas'
import { alternar, alternarTodas } from '../features/tramites/flujo'
import { descargarTexto, nombreArchivo, tramitesACsv } from '../features/tramites/exportar'
import { hoyEnBuenosAires } from '../features/tramites/filtros'
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
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set())
  const [reasignando, setReasignando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const resultado = useRef<{ n: number; gestora: string }>({ n: 0, gestora: '' })
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

  // Solo cuentan las marcadas que siguen visibles con los filtros actuales.
  const idsMarcados = (lista.data ?? []).filter((t) => marcadas.has(t.id)).map((t) => t.id)
  const gestoras = (catalogos.data?.perfiles ?? []).filter((p) => p.rol === 'gestora' && p.activo)
  useEffect(() => {
    if (!aviso) return
    const h = window.setTimeout(() => setAviso(null), 6000)
    return () => window.clearTimeout(h)
  }, [aviso])

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
            <>
              <Button
                variante="secundario"
                icono={<IconoDescarga className="size-[18px]" />}
                disabled={!lista.data?.length}
                title="Descarga los trámites visibles, con los filtros aplicados, para abrir en Excel"
                onClick={() => lista.data && descargarTexto(nombreArchivo(hoyEnBuenosAires()), tramitesACsv(lista.data, nombre))}
              >
                Exportar a Excel
              </Button>
              <Button icono={<IconoMas className="size-[18px]" />} disabled={!catalogos.data} onClick={() => setAltaAbierta(true)}>
                Nuevo trámite
              </Button>
            </>
          }
        />
        <FiltrosTramites filtros={filtros} catalogos={catalogos.data} onCambiar={cambiarFiltros} />
        {idsMarcados.length > 0 && (
          <section
            aria-label="Selección"
            className="sticky top-3 z-20 mt-4 hidden items-center gap-3 rounded-lg bg-noche py-2 pr-2 pl-4 text-superficie shadow-flotante md:flex"
          >
            <span className="cifra text-[14px] font-medium">
              {idsMarcados.length === 1 ? '1 trámite seleccionado' : `${idsMarcados.length} trámites seleccionados`}
            </span>
            <span className="flex-1" />
            <Button tamano="sm" className="bg-superficie text-tinta hover:bg-hundido" icono={<IconoUsuario className="size-4" />} onClick={() => setReasignando(true)}>
              Reasignar gestora
            </Button>
            <button
              type="button"
              onClick={() => setMarcadas(new Set())}
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconoCerrar className="size-4" /> Quitar selección
            </button>
          </section>
        )}
        {aviso && (
          <div role="status" className="mt-4 flex items-center gap-2.5 rounded-lg bg-disponible-suave px-4 py-3 text-[14px] font-medium text-disponible ring-1 ring-disponible/20">
            <IconoCheck className="size-4" /> {aviso}
          </div>
        )}
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
              marcadas={marcadas}
              onMarcar={(id) => setMarcadas((s) => alternar(s, id))}
              onMarcarTodas={() => setMarcadas((s) => alternarTodas(s, lista.data!.map((t) => t.id)))}
              pie={lista.data.length >= LIMITE ? 'Se muestran los 500 más recientes. Afiná la búsqueda para ver otros.' : undefined}
            />
          )}
        </div>
      </div>
      {seleccionado && catalogos.data && (
        <PanelDetalle id={seleccionado} catalogos={catalogos.data} nombre={nombre} onCerrar={() => seleccionar(null)} />
      )}
      {reasignando && (
        <FormAccion
          titulo={idsMarcados.length === 1 ? 'Reasignar 1 trámite' : `Reasignar ${idsMarcados.length} trámites`}
          rotulo="Reasignación en lote"
          boton="Confirmar reasignación"
          pideGestora
          gestoras={gestoras}
          aviso="Cada trámite pasa a la gestora elegida y el motivo queda en su historial. Si uno falla, no se cambia ninguno."
          pideMotivo="Indicá el motivo de la reasignación."
          ejecutar={async (gestora, motivo) => {
            const n = await reasignarGestora(idsMarcados, gestora, motivo)
            resultado.current = { n, gestora: nombre(gestora) }
          }}
          onHecho={() => {
            const { n, gestora } = resultado.current
            setAviso(n === 0 ? `Ya estaban asignados a ${gestora}.` : `Se reasignaron ${n === 1 ? '1 trámite' : `${n} trámites`} a ${gestora}.`)
            setMarcadas(new Set())
          }}
          onCerrar={() => setReasignando(false)}
        />
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
