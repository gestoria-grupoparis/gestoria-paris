import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSesion } from '../lib/sesion'
import {
  listarCompromisos, listarExtracto, listarPendientes, listarSaldos, POR_PAGINA, type Movimiento,
} from '../features/habitualista/consultas'
import { useFinanzasEnVivo } from '../features/habitualista/enVivo'
import { FormAjuste } from '../features/habitualista/FormAjuste'
import { FormCarga } from '../features/habitualista/FormCarga'
import { FormConciliacion } from '../features/habitualista/FormConciliacion'
import { FormReversion } from '../features/habitualista/FormReversion'
import { TablaCompromisos } from '../features/habitualista/TablaCompromisos'
import { TablaExtracto } from '../features/habitualista/TablaExtracto'
import { TarjetasSaldo } from '../features/habitualista/TarjetasSaldo'
import {
  Button, Cargando, EmptyState, ErrorState, IconoCheck, IconoChevron, IconoDoc, IconoMas, PageHeader, Skeleton,
  claseControl, cx,
} from '../ui'

type Dialogo = { tipo: 'carga' } | { tipo: 'ajuste' } | { tipo: 'conciliar' } | { tipo: 'revertir'; m: Movimiento }
type Pestana = 'movimientos' | 'compromisos'

export function Habitualista() {
  const { rol } = useSesion()
  const [params, setParams] = useSearchParams()
  const [pestana, setPestana] = useState<Pestana>('movimientos')
  const [pagina, setPagina] = useState(0)
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const qc = useQueryClient()
  useFinanzasEnVivo('habitualista-pantalla', 'habitualista')

  const saldos = useQuery({ queryKey: ['habitualista', 'saldos'], queryFn: listarSaldos })
  const saldo = saldos.data?.find((s) => s.empresa_id === params.get('empresa')) ?? saldos.data?.[0]
  const extracto = useQuery({
    queryKey: ['habitualista', 'extracto', saldo?.cuenta_id, pagina],
    queryFn: () => listarExtracto(saldo!.cuenta_id, pagina),
    enabled: !!saldo,
    placeholderData: keepPreviousData,
  })
  const pendientes = useQuery({
    queryKey: ['habitualista', 'pendientes', saldo?.cuenta_id],
    queryFn: () => listarPendientes(saldo!.cuenta_id),
    enabled: !!saldo && dialogo?.tipo === 'conciliar',
  })
  const compromisos = useQuery({
    queryKey: ['habitualista', 'compromisos', saldo?.empresa_id],
    queryFn: () => listarCompromisos(saldo!.empresa_id),
    enabled: !!saldo && pestana === 'compromisos',
  })

  const refrescar = () => {
    setDialogo(null)
    void qc.invalidateQueries({ queryKey: ['habitualista'] })
  }
  const empresa = saldo && { id: saldo.empresa_id, nombre: saldo.empresa }

  const paginacion = extracto.data && (pagina > 0 || extracto.data.hayMas) && (
    <nav aria-label="Páginas del extracto" className="flex flex-wrap items-center justify-between gap-3">
      <span>
        Página <strong className="cifra text-tinta">{pagina + 1}</strong> · {POR_PAGINA} movimientos por página
      </span>
      <span className="flex gap-2">
        <Button variante="secundario" tamano="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}
          icono={<IconoChevron className="size-4 rotate-180" />}>
          Más recientes
        </Button>
        <Button variante="secundario" tamano="sm" disabled={!extracto.data.hayMas} onClick={() => setPagina((p) => p + 1)}>
          Anteriores <IconoChevron className="size-4" />
        </Button>
      </span>
    </nav>
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo="Fondos de gestoría"
        titulo="Habitualista"
        descripcion="Cuánta plata hay en la cuenta, cuánto ya está comprometido por trámites en curso y cada movimiento con su saldo."
        acciones={
          empresa && (
            <>
              <Button icono={<IconoMas />} onClick={() => setDialogo({ tipo: 'carga' })}>Registrar carga</Button>
              <Button variante="secundario" icono={<IconoCheck />} onClick={() => setDialogo({ tipo: 'conciliar' })}>
                Conciliar
              </Button>
              {rol === 'gerencia' && (
                <Button variante="secundario" icono={<IconoDoc />} onClick={() => setDialogo({ tipo: 'ajuste' })}>
                  Ajuste
                </Button>
              )}
            </>
          )
        }
      />

      {saldos.isError ? (
        <ErrorState
          titulo="No se pudieron cargar los saldos."
          descripcion="Revisá la conexión y probá de nuevo."
          accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void saldos.refetch()}>Reintentar</Button>}
        />
      ) : !saldos.data ? (
        <div role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <span className="sr-only">Cargando saldos…</span>
          <Skeleton className="h-32 rounded-lg sm:col-span-2" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg sm:col-span-2 lg:col-span-1" />
        </div>
      ) : !saldo ? (
        <EmptyState
          titulo="No tenés alcance sobre ninguna razón social completa."
          descripcion="Pedile a gerencia que te asigne una razón social para ver sus fondos."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Razón social</span>
              <select
                value={saldo.empresa_id}
                onChange={(e) => {
                  setPagina(0)
                  setParams({ empresa: e.target.value }, { replace: true })
                }}
                className={cx(claseControl, 'min-w-60 font-semibold')}
              >
                {saldos.data.map((s) => (
                  <option key={s.empresa_id} value={s.empresa_id}>{s.empresa}</option>
                ))}
              </select>
            </label>
            <p className="text-[13px] text-tenue">Se actualiza sola cuando alguien registra un movimiento.</p>
          </div>

          <TarjetasSaldo saldo={saldo} />

          <section aria-label="Detalle de la cuenta" className="flex flex-col gap-4">
            <div role="tablist" aria-label="Vista" className="flex w-fit gap-1 rounded-lg bg-hundido p-1">
              {(['movimientos', 'compromisos'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={pestana === p}
                  onClick={() => setPestana(p)}
                  className={cx(
                    'h-10 rounded-md px-4 text-sm font-semibold transition-colors',
                    pestana === p ? 'bg-superficie text-tinta shadow-tarjeta' : 'text-tenue hover:text-tinta',
                  )}
                >
                  {p === 'movimientos' ? 'Movimientos' : 'Compromisos'}
                </button>
              ))}
            </div>
            {pestana === 'movimientos' ? (
              extracto.isError ? (
                <ErrorState titulo="No se pudo cargar el extracto." />
              ) : !extracto.data ? (
                <Cargando etiqueta="Cargando movimientos…" />
              ) : (
                <TablaExtracto
                  filas={extracto.data.filas}
                  onRevertir={(m) => setDialogo({ tipo: 'revertir', m })}
                  pie={paginacion || undefined}
                />
              )
            ) : compromisos.isError ? (
              <ErrorState titulo="No se pudieron cargar los compromisos." />
            ) : !compromisos.data ? (
              <Cargando etiqueta="Cargando compromisos…" />
            ) : (
              <TablaCompromisos filas={compromisos.data} esGerencia={rol === 'gerencia'} onCambio={refrescar} />
            )}
          </section>
        </div>
      )}

      {empresa && dialogo?.tipo === 'carga' && (
        <FormCarga empresa={empresa} onCerrar={() => setDialogo(null)} onGuardado={refrescar} />
      )}
      {empresa && dialogo?.tipo === 'ajuste' && (
        <FormAjuste empresa={empresa} onCerrar={() => setDialogo(null)} onGuardado={refrescar} />
      )}
      {empresa && dialogo?.tipo === 'conciliar' && (
        <FormConciliacion
          empresa={empresa}
          pendientes={pendientes.data ?? []}
          cargando={!pendientes.data}
          onCerrar={() => setDialogo(null)}
          onGuardado={refrescar}
        />
      )}
      {dialogo?.tipo === 'revertir' && (
        <FormReversion movimiento={dialogo.m} onCerrar={() => setDialogo(null)} onGuardado={refrescar} />
      )}
    </div>
  )
}
