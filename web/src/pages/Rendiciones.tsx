import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { formatearPesos, parsearPesos } from '../lib/dinero'
import { mensajeError } from '../lib/errores'
import { useMutacionUnica } from '../lib/consultas'
import { useSesion } from '../lib/sesion'
import { supabase } from '../lib/supabase'
import { etiquetaMes } from '../features/informes/meses'
import { hoyEnBuenosAires } from '../features/tramites/filtros'
import {
  crearRendicion, gestorasActivas, listarRendiciones, obtenerRendicion, type RendicionDetalle, type RendicionFila,
} from '../features/rendiciones/consultas'
import { ChipRendicion, Semaforo, puedeEditar } from '../features/rendiciones/comun'
import { CargaPlanilla } from '../features/rendiciones/CargaPlanilla'
import { CargaComprobantes } from '../features/rendiciones/CargaComprobantes'
import { PanelControles } from '../features/rendiciones/PanelControles'
import { terminarOcr } from '../features/rendiciones/lectura'
import {
  Button, CampoPesos, Cargando, DataTable, Dialogo, EmptyState, ErrorState, Field, PageHeader,
  celdaMonto, celdaPrincipal, claseControl, cx,
} from '../ui'

const mesDe = (periodo: string) => periodo.slice(0, 7)

function mesAnterior(hoy: string): string {
  let a = Number(hoy.slice(0, 4))
  let m = Number(hoy.slice(5, 7)) - 1
  if (m === 0) { m = 12; a -= 1 }
  return `${a}-${String(m).padStart(2, '0')}`
}

function useEmpresas() {
  return useQuery({
    queryKey: ['empresas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empresas').select('id,nombre').order('nombre')
      if (error) throw error
      return (data ?? []) as { id: string; nombre: string }[]
    },
    staleTime: 5 * 60_000,
  })
}

export function Rendiciones() {
  const [params, setParams] = useSearchParams()
  const id = params.get('r')
  // El worker de OCR vive mientras se usa la pantalla.
  useEffect(() => () => void terminarOcr(), [])
  const abrir = (r: string | null) => {
    const p = new URLSearchParams(params)
    if (r) p.set('r', r)
    else p.delete('r')
    p.delete('vista')
    setParams(p)
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8">
      {id ? <Detalle id={id} onVolver={() => abrir(null)} /> : <Lista onAbrir={abrir} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------------------

function Filtro({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="rotulo">{etiqueta}</span>
      {children}
    </label>
  )
}

function Lista({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [params, setParams] = useSearchParams()
  const empresa = params.get('empresa') ?? ''
  const periodo = params.get('mes') ?? ''
  const [creando, setCreando] = useState(false)
  const empresas = useEmpresas()
  const lista = useQuery({
    queryKey: ['rendiciones', 'lista', empresa, periodo],
    queryFn: () => listarRendiciones({ empresa: empresa || undefined, periodo: periodo || undefined }),
    placeholderData: keepPreviousData,
  })
  const cambiar = (clave: string, valor: string) => {
    const p = new URLSearchParams(params)
    if (valor) p.set(clave, valor)
    else p.delete(clave)
    setParams(p, { replace: true })
  }

  return (
    <>
      <PageHeader
        rotulo="Cierre del mes"
        titulo="Rendiciones"
        descripcion="La gestora carga la planilla del mes y sus comprobantes; el sistema los lee y controla importes, autorizaciones y honorarios. La rendición no mueve dinero: solo compara."
        acciones={<Button onClick={() => setCreando(true)}>Nueva rendición</Button>}
      />
      <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg bg-superficie p-4 ring-1 ring-linea sm:grid-cols-2 md:flex md:gap-4">
        <Filtro etiqueta="Razón social">
          <select value={empresa} onChange={(e) => cambiar('empresa', e.target.value)} className={cx(claseControl, 'md:min-w-56')}>
            <option value="">Todas</option>
            {empresas.data?.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Filtro>
        <Filtro etiqueta="Mes">
          <input type="month" value={periodo} onChange={(e) => cambiar('mes', e.target.value)} className={cx(claseControl, 'md:min-w-48')} />
        </Filtro>
      </div>

      {lista.isError ? (
        <ErrorState
          titulo="No se pudieron cargar las rendiciones."
          descripcion={mensajeError(lista.error)}
          accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void lista.refetch()}>Reintentar</Button>}
        />
      ) : !lista.data ? (
        <Cargando etiqueta="Cargando rendiciones…" />
      ) : lista.data.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay rendiciones."
          descripcion="Creá la del mes para empezar."
          accion={<Button variante="secundario" tamano="sm" onClick={() => setCreando(true)}>Nueva rendición</Button>}
        />
      ) : (
        <TablaRendiciones filas={lista.data} onAbrir={onAbrir} />
      )}

      {creando && <DialogoNueva empresas={empresas.data ?? []} onCerrar={() => setCreando(false)} onCreada={onAbrir} />}
    </>
  )
}

function TablaRendiciones({ filas, onAbrir }: { filas: RendicionFila[]; onAbrir: (id: string) => void }) {
  return (
    <>
      <DataTable aria-label="Rendiciones" className="hidden min-w-[860px] md:table">
        <thead>
          <tr>
            <th>Razón social</th>
            <th>Mes</th>
            <th>Gestora</th>
            <th>Estado</th>
            <th className="!text-right">Filas</th>
            <th className="!text-right">Total</th>
            <th>Controles</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id} className="cursor-pointer" onClick={() => onAbrir(r.id)}>
              <td className={celdaPrincipal}>
                <button type="button" className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); onAbrir(r.id) }}>
                  {r.empresa}
                </button>
              </td>
              <td>{etiquetaMes(mesDe(r.periodo))}</td>
              <td>{r.gestora}</td>
              <td><ChipRendicion estado={r.estado} /></td>
              <td className={celdaMonto}>{r.filas}</td>
              <td className={celdaMonto}>{formatearPesos(r.total)}</td>
              <td><Semaforo controles={r.controles} /></td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <ul aria-label="Rendiciones (lista)" className="flex flex-col gap-3 md:hidden">
        {filas.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onAbrir(r.id)} className="flex w-full flex-col gap-2 rounded-lg bg-superficie p-4 text-left ring-1 ring-linea">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{r.empresa}</span>
                <ChipRendicion estado={r.estado} />
              </span>
              <span className="text-[13px] text-tenue">{etiquetaMes(mesDe(r.periodo))} · {r.gestora} · {r.filas} filas</span>
              <span className="flex items-center justify-between">
                <span className="cifra font-medium">{formatearPesos(r.total)}</span>
                <Semaforo controles={r.controles} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function DialogoNueva({ empresas, onCerrar, onCreada }: {
  empresas: { id: string; nombre: string }[]
  onCerrar: () => void
  onCreada: (id: string) => void
}) {
  const { rol } = useSesion()
  const qc = useQueryClient()
  const eligeGestora = rol === 'gerencia' || rol === 'contable'
  const gestoras = useQuery({ queryKey: ['gestoras'], queryFn: gestorasActivas, enabled: eligeGestora })
  const [empresa, setEmpresa] = useState('')
  const [mes, setMes] = useState(mesAnterior(hoyEnBuenosAires()))
  const [honorario, setHonorario] = useState('32.500,00')
  const [gestora, setGestora] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const crear = useMutacionUnica({
    mutationFn: crearRendicion,
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['rendiciones'] })
      onCerrar()
      onCreada(id)
    },
  })

  const enviar = () => {
    const e: Record<string, string> = {}
    if (!empresa) e.empresa = 'Elegí la razón social.'
    if (!/^\d{4}-\d{2}$/.test(mes)) e.mes = 'Elegí el mes.'
    let cents = ''
    try {
      const c = parsearPesos(honorario)
      if (c <= 0n) e.honorario = 'El honorario debe ser mayor a cero.'
      cents = c.toString()
    } catch (err) {
      e.honorario = (err as Error).message
    }
    if (eligeGestora && !gestora) e.gestora = 'Elegí la gestora.'
    setErrores(e)
    if (Object.keys(e).length) return
    crear.mutate({ empresa, periodo: mes, honorario: cents, gestora: eligeGestora ? gestora : null })
  }

  return (
    <Dialogo titulo="Nueva rendición" rotulo="Rendiciones" onCerrar={onCerrar} bloqueado={crear.isPending} sucio={!!empresa}>
      <form className="flex flex-col gap-4" onSubmit={(ev) => { ev.preventDefault(); enviar() }} noValidate>
        <Field label="Razón social" error={errores.empresa}>
          {(p) => (
            <select {...p} value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={claseControl}>
              <option value="">Elegí…</option>
              {empresas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          )}
        </Field>
        <Field label="Mes" error={errores.mes}>
          {(p) => <input {...p} type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={claseControl} />}
        </Field>
        {eligeGestora && (
          <Field label="Gestora" error={errores.gestora}>
            {(p) => (
              <select {...p} value={gestora} onChange={(e) => setGestora(e.target.value)} className={claseControl} disabled={!gestoras.data}>
                <option value="">{gestoras.isLoading ? 'Cargando…' : 'Elegí…'}</option>
                {gestoras.data?.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Honorario por trámite" error={errores.honorario} ayuda="Se multiplica por la cantidad de trámites rendidos.">
          {(p) => <CampoPesos {...p} value={honorario} onValor={setHonorario} />}
        </Field>
        {crear.isError && (
          <p role="alert" className="rounded-md bg-sinfondos-suave px-4 py-3 text-sm font-medium text-sinfondos">{mensajeError(crear.error)}</p>
        )}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variante="secundario" onClick={onCerrar} disabled={crear.isPending}>Cancelar</Button>
          <Button type="submit" cargando={crear.isPending}>Crear rendición</Button>
        </div>
      </form>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------------------

type Vista = 'planilla' | 'comprobantes' | 'controles'
const VISTAS: [Vista, string][] = [['planilla', 'Planilla'], ['comprobantes', 'Comprobantes'], ['controles', 'Controles']]

function Detalle({ id, onVolver }: { id: string; onVolver: () => void }) {
  const [params, setParams] = useSearchParams()
  const vista: Vista = (VISTAS.map((v) => v[0]) as string[]).includes(params.get('vista') ?? '') ? (params.get('vista') as Vista) : 'planilla'
  const [filaFoco, setFiloFoco] = useState<string | null>(null)
  const detalle = useQuery({ queryKey: ['rendiciones', 'detalle', id], queryFn: () => obtenerRendicion(id) })
  const ir = (v: Vista, fila?: string) => {
    setFiloFoco(fila ?? null)
    const p = new URLSearchParams(params)
    if (v === 'planilla') p.delete('vista')
    else p.set('vista', v)
    setParams(p, { replace: true })
  }

  if (detalle.isError)
    return (
      <ErrorState
        titulo="No se pudo abrir la rendición."
        descripcion={mensajeError(detalle.error)}
        accion={
          <div className="flex gap-2">
            <Button variante="secundario" tamano="sm" onClick={() => void detalle.refetch()}>Reintentar</Button>
            <Button variante="fantasma" tamano="sm" onClick={onVolver}>Volver a la lista</Button>
          </div>
        }
      />
    )
  if (!detalle.data) return <Cargando etiqueta="Abriendo la rendición…" />
  const r: RendicionDetalle = detalle.data

  return (
    <>
      <button type="button" onClick={onVolver} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-tenue hover:text-tinta">
        <span aria-hidden>‹</span> Rendiciones
      </button>
      <PageHeader
        rotulo={<span className="inline-flex items-center gap-2">Rendición <ChipRendicion estado={r.estado} /></span>}
        titulo={`${r.empresa} · ${etiquetaMes(mesDe(r.periodo))}`}
        descripcion={`Gestora: ${r.gestora} · Honorario por trámite ${formatearPesos(r.honorario)}`}
      />
      {r.estado === 'observada' && r.motivo_observacion && (
        <div role="note" className="mb-5 rounded-lg bg-comprometido-suave px-4 py-3 text-sm text-comprometido ring-1 ring-comprometido/25">
          <strong className="font-semibold">Observada:</strong> {r.motivo_observacion}
        </div>
      )}
      <div role="tablist" aria-label="Secciones de la rendición" className="mb-6 flex w-full gap-1 overflow-x-auto rounded-lg bg-hundido p-1 md:w-fit">
        {VISTAS.map(([v, etiqueta]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={vista === v}
            onClick={() => ir(v)}
            className={cx(
              'h-10 flex-1 rounded-md px-4 text-sm font-semibold whitespace-nowrap transition-colors md:flex-none',
              vista === v ? 'bg-superficie text-tinta shadow-tarjeta' : 'text-tenue hover:text-tinta',
            )}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      {vista === 'planilla' && <CargaPlanilla key={r.filas.map((f) => f.id).join()} rendicion={r} editable={puedeEditar(r.estado)} />}
      {vista === 'comprobantes' && <CargaComprobantes rendicion={r} editable={puedeEditar(r.estado)} filaFoco={filaFoco} />}
      {vista === 'controles' && <PanelControles rendicion={r} onIr={ir} />}
    </>
  )
}
