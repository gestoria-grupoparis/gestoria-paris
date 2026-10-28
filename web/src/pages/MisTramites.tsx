import type { ReactElement } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSesion } from '../lib/sesion'
import { mensajeError } from '../lib/errores'
import { cambiarEstado, marcar } from '../features/tramites/consultas'
import { GRUPOS, grupoDe, listarMisTramites, type TramiteGestora } from '../features/gestora/consultas'
import { TarjetaTramite, type AccionGestora } from '../features/gestora/TarjetaTramite'
import { FormPresupuesto } from '../features/gestora/FormPresupuesto'
import { FormPago } from '../features/gestora/FormPago'
import { Button, Cargando, EmptyState, ErrorState, PageHeader, cx } from '../ui'
import { IconoAlerta, IconoCheck, IconoDoc, IconoFlecha, IconoReloj } from '../ui/Iconos'
import type { Grupo } from '../features/gestora/consultas'

const ICONO_GRUPO: Record<Grupo, (p: { className?: string }) => ReactElement> = {
  presupuestar: IconoDoc,
  listos: IconoFlecha,
  presentados: IconoReloj,
  retirar: IconoCheck,
}

const AYUDA_GRUPO: Record<Grupo, string> = {
  presupuestar: 'Cargá lo que va a costar en el registro. El total lo calcula el sistema.',
  listos: 'Ya tienen presupuesto. Presentalos en el registro y marcalos.',
  presentados: 'En el registro. Registrá el pago y marcá cuando el registro termine.',
  retirar: 'El registro terminó. Pasá a retirar la documentación.',
}

type Formulario = { tipo: 'presupuesto' | 'pago'; t: TramiteGestora } | null

function ejecutar(t: TramiteGestora, a: AccionGestora) {
  if (a === 'presentado') return cambiarEstado(t.id, 'presentado', '', t.version)
  if (a === 'finalizado') return cambiarEstado(t.id, 'finalizado_registro', '', t.version)
  return marcar(t.id, 'retirado')
}

export function MisTramites() {
  const { perfil } = useSesion()
  const qc = useQueryClient()
  const clave = ['mis-tramites', perfil?.id]
  const consulta = useQuery({ queryKey: clave, queryFn: () => listarMisTramites(perfil!.id), enabled: !!perfil })
  const [form, setForm] = useState<Formulario>(null)
  const [error, setError] = useState<string | null>(null)
  const refrescar = () => qc.invalidateQueries({ queryKey: clave })

  const accion = useMutation({
    mutationFn: ({ t, a }: { t: TramiteGestora; a: AccionGestora }) => ejecutar(t, a),
    onMutate: () => setError(null),
    onError: (e) => setError(mensajeError(e)),
    onSettled: refrescar,
  })

  function alAccionar(t: TramiteGestora, a: AccionGestora) {
    if (a === 'presupuesto' || a === 'pago') setForm({ tipo: a, t })
    else accion.mutate({ t, a })
  }

  const tramites = consulta.data ?? []
  const grupos = GRUPOS.map((g) => ({ ...g, items: tramites.filter((t) => grupoDe(t) === g.id) })).filter(
    (g) => g.items.length,
  )
  const cerrar = () => setForm(null)
  const guardado = () => {
    setForm(null)
    void refrescar()
  }

  const nombre = perfil?.nombre?.split(' ')[0]
  const pendientes = grupos.reduce((n, g) => n + g.items.length, 0)
  const bloqueados = tramites.filter((t) => t.situacion === 'sin_fondos').length

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo="Gestoría · Tu jornada"
        titulo={nombre ? `Hola, ${nombre}` : 'Mis trámites'}
        descripcion="Mis trámites asignados, ordenados por lo que tenés que hacer ahora."
      />

      {consulta.isSuccess && pendientes > 0 && (
        <nav aria-label="Resumen" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:px-0">
          {GRUPOS.map((g) => {
            const n = grupos.find((x) => x.id === g.id)?.items.length ?? 0
            const Icono = ICONO_GRUPO[g.id]
            return (
              <a
                key={g.id}
                href={n ? `#seccion-${g.id}` : undefined}
                aria-disabled={!n || undefined}
                className={cx(
                  'flex min-w-[132px] shrink-0 flex-col gap-2 rounded-lg px-4 py-3 ring-1 md:min-w-0',
                  n ? 'bg-superficie shadow-tarjeta ring-linea hover:ring-marca/40' : 'bg-transparent text-tenue ring-linea',
                )}
              >
                <span className="flex items-center justify-between">
                  <Icono className={cx('size-[18px]', n ? 'text-marca' : 'text-tenue')} />
                  <span className="cifra font-display text-[26px] leading-none font-extrabold">{n}</span>
                </span>
                <span className="text-[13px] font-semibold">{g.titulo}</span>
              </a>
            )
          })}
        </nav>
      )}

      {bloqueados > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg bg-sinfondos-suave px-4 py-3 text-sinfondos ring-1 ring-sinfondos/25">
          <IconoAlerta className="mt-0.5" />
          <p className="text-[14px] text-tinta">
            <strong className="text-sinfondos">
              {bloqueados === 1 ? '1 trámite frenado' : `${bloqueados} trámites frenados`} por falta de fondos.
            </strong>{' '}
            No los presentes hasta que contaduría te avise.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorState titulo="No se pudo guardar" descripcion={error} />
        </div>
      )}
      {consulta.isPending && <Cargando filas={4} etiqueta="Cargando tus trámites…" />}
      {consulta.isError && (
        <ErrorState
          titulo="No pudimos traer tus trámites"
          descripcion={mensajeError(consulta.error)}
          accion={<Button variante="secundario" tamano="sm" className="self-start" onClick={() => void consulta.refetch()}>Reintentar</Button>}
        />
      )}
      {consulta.isSuccess && !grupos.length && (
        <EmptyState
          icono={<IconoCheck className="size-6" />}
          titulo="Estás al día"
          descripcion="No tenés trámites pendientes. Cuando te asignen uno, aparece acá."
        />
      )}
      <div className="space-y-9 xl:grid xl:grid-cols-3 xl:items-start xl:gap-6 xl:space-y-0">
        {grupos.map((g) => {
          const Icono = ICONO_GRUPO[g.id]
          return (
            <section key={g.id} aria-labelledby={`grupo-${g.id}`} id={`seccion-${g.id}`} className="scroll-mt-20">
              <h2 id={`grupo-${g.id}`} className="mb-3 flex items-center gap-2.5 text-[20px] font-extrabold tracking-tight">
                <span aria-hidden className="grid size-8 place-items-center rounded-md bg-marca-suave text-marca">
                  <Icono className="size-[18px]" />
                </span>
                {g.titulo}
                <span className="cifra ml-auto rounded-full bg-hundido px-2.5 py-0.5 text-[13px] font-bold text-tenue" aria-hidden="true">
                  {g.items.length}
                </span>
              </h2>
              <p className="mb-4 text-[14px] text-tenue xl:min-h-10">{AYUDA_GRUPO[g.id]}</p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                {g.items.map((t) => (
                  <TarjetaTramite
                    key={t.id}
                    t={t}
                    grupo={g.id}
                    ocupado={accion.isPending}
                    onAccion={(a) => alAccionar(t, a)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {form?.tipo === 'presupuesto' && <FormPresupuesto tramite={form.t} onCerrar={cerrar} onGuardado={guardado} />}
      {form?.tipo === 'pago' && <FormPago tramite={form.t} onCerrar={cerrar} onGuardado={guardado} />}
    </div>
  )
}
