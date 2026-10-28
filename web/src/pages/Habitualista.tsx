import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSesion } from '../lib/sesion'
import { listarCompromisos, listarExtracto, listarSaldos, type Movimiento } from '../features/habitualista/consultas'
import { useFinanzasEnVivo } from '../features/habitualista/enVivo'
import { FormAjuste } from '../features/habitualista/FormAjuste'
import { FormCarga } from '../features/habitualista/FormCarga'
import { FormConciliacion } from '../features/habitualista/FormConciliacion'
import { FormReversion } from '../features/habitualista/FormReversion'
import { TablaCompromisos } from '../features/habitualista/TablaCompromisos'
import { TablaExtracto } from '../features/habitualista/TablaExtracto'
import { TarjetasSaldo } from '../features/habitualista/TarjetasSaldo'
import { CLASE_PRIMARIO, CLASE_SECUNDARIO } from '../features/tramites/Dialogo'

type Dialogo = { tipo: 'carga' } | { tipo: 'ajuste' } | { tipo: 'conciliar' } | { tipo: 'revertir'; m: Movimiento }
type Pestana = 'movimientos' | 'compromisos'

export function Habitualista() {
  const { rol } = useSesion()
  const [params, setParams] = useSearchParams()
  const [pestana, setPestana] = useState<Pestana>('movimientos')
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const qc = useQueryClient()
  useFinanzasEnVivo('habitualista-pantalla', 'habitualista')

  const saldos = useQuery({ queryKey: ['habitualista', 'saldos'], queryFn: listarSaldos })
  const saldo = saldos.data?.find((s) => s.empresa_id === params.get('empresa')) ?? saldos.data?.[0]
  const extracto = useQuery({
    queryKey: ['habitualista', 'extracto', saldo?.cuenta_id],
    queryFn: () => listarExtracto(saldo!.cuenta_id),
    enabled: !!saldo,
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

  return (
    <div className="space-y-3 px-4 py-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-lg font-semibold">Habitualista</h1>
          {saldos.data && saldos.data.length > 0 && (
            <label className="text-xs font-medium text-tenue">
              Razón social
              <select
                value={saldo?.empresa_id}
                onChange={(e) => setParams({ empresa: e.target.value }, { replace: true })}
                className="ml-2 border border-linea bg-white px-2 py-1 text-sm text-tinta"
              >
                {saldos.data.map((s) => (
                  <option key={s.empresa_id} value={s.empresa_id}>{s.empresa}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {empresa && (
          <div className="flex gap-2">
            <button type="button" className={CLASE_PRIMARIO} onClick={() => setDialogo({ tipo: 'carga' })}>
              Registrar carga
            </button>
            {rol === 'gerencia' && (
              <button type="button" className={CLASE_SECUNDARIO} onClick={() => setDialogo({ tipo: 'ajuste' })}>
                Ajuste
              </button>
            )}
            <button type="button" className={CLASE_SECUNDARIO} onClick={() => setDialogo({ tipo: 'conciliar' })}>
              Conciliar
            </button>
          </div>
        )}
      </header>

      {saldos.isError ? (
        <p role="alert" className="text-sm text-alerta">
          No se pudieron cargar los saldos.{' '}
          <button type="button" className="underline" onClick={() => void saldos.refetch()}>Reintentar</button>
        </p>
      ) : !saldos.data ? (
        <p className="text-sm text-tenue">Cargando saldos…</p>
      ) : !saldo ? (
        <p className="text-sm text-tenue">No tenés alcance sobre ninguna razón social completa.</p>
      ) : (
        <>
          <TarjetasSaldo saldo={saldo} />
          <div role="tablist" aria-label="Vista" className="flex gap-4 border-b border-linea text-sm">
            {(['movimientos', 'compromisos'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={pestana === p}
                onClick={() => setPestana(p)}
                className={`-mb-px border-b-2 py-1.5 font-medium ${pestana === p ? 'border-marca text-tinta' : 'border-transparent text-tenue'}`}
              >
                {p === 'movimientos' ? 'Movimientos' : 'Compromisos'}
              </button>
            ))}
          </div>
          {pestana === 'movimientos' ? (
            extracto.isError ? (
              <p role="alert" className="text-sm text-alerta">No se pudo cargar el extracto.</p>
            ) : !extracto.data ? (
              <p className="text-sm text-tenue">Cargando movimientos…</p>
            ) : (
              <TablaExtracto filas={extracto.data} onRevertir={(m) => setDialogo({ tipo: 'revertir', m })} />
            )
          ) : compromisos.isError ? (
            <p role="alert" className="text-sm text-alerta">No se pudieron cargar los compromisos.</p>
          ) : !compromisos.data ? (
            <p className="text-sm text-tenue">Cargando compromisos…</p>
          ) : (
            <TablaCompromisos filas={compromisos.data} esGerencia={rol === 'gerencia'} onCambio={refrescar} />
          )}
        </>
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
          pendientes={(extracto.data ?? []).filter((m) => !m.conciliado)}
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
