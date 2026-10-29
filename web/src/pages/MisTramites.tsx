import type { ReactElement } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSesion } from '../lib/sesion'
import { mensajeError } from '../lib/errores'
import { formatearPesos } from '../lib/dinero'
import { cambiarEstado, marcar } from '../features/tramites/consultas'
import { GRUPOS, grupoDe, listarMisTramites, listarSaldosGestora, type TramiteGestora } from '../features/gestora/consultas'
import { TarjetaTramite, type AccionGestora } from '../features/gestora/TarjetaTramite'
import { FormPresupuesto } from '../features/gestora/FormPresupuesto'
import { FormPago } from '../features/gestora/FormPago'
import { Button, Cargando, EmptyState, ErrorState, PageHeader, cx } from '../ui'
import { IconoAlerta, IconoCheck, IconoDoc, IconoFlecha, IconoReloj, IconoRetorno } from '../ui/Iconos'
import type { Grupo } from '../features/gestora/consultas'

const ICONO_GRUPO: Record<Grupo, (p: { className?: string }) => ReactElement> = {
  presupuestar: IconoDoc,
  aprobacion: IconoReloj,
  listos: IconoFlecha,
  presentados: IconoCheck,
  devolver: IconoRetorno,
}

const AYUDA_GRUPO: Record<Grupo, string> = {
  presupuestar: 'Cargá lo que va a costar en el registro. Va a la empresa para que lo apruebe.',
  aprobacion: 'La empresa está revisando tu presupuesto y apartando la plata. Te llega un aviso cuando lo aprueben.',
  listos: 'Presupuesto aprobado: retirá el legajo en la concesionaria y presentalo en el registro.',
  presentados: 'En el registro. Registrá el pago y marcá cuando el registro termine.',
  devolver: 'El registro terminó. Devolvé la documentación a la empresa y marcalo.',
}

type Formulario = { tipo: 'presupuesto' | 'pago'; t: TramiteGestora } | null

function ejecutar(t: TramiteGestora, a: AccionGestora) {
  if (a === 'presentado') return cambiarEstado(t.id, 'presentado', '', t.version)
  if (a === 'finalizado') return cambiarEstado(t.id, 'finalizado_registro', '', t.version)
  if (a === 'devuelto') return cambiarEstado(t.id, 'devuelto', '', t.version)
  return marcar(t.id, 'retirado')
}

const esNegativo = (cents: string) => cents.startsWith('-') && !/^-0+$/.test(cents)

// Pantalla de la gestora: la mitad "gestoría" del ping pong con la empresa. Solo lo básico:
// la plata de cada razón social, sus trámites y el próximo paso de cada uno.
export function MisTramites() {
  const { perfil } = useSesion()
  const qc = useQueryClient()
  const clave = ['mis-tramites', perfil?.id]
  const consulta = useQuery({ queryKey: clave, queryFn: () => listarMisTramites(perfil!.id), enabled: !!perfil })
  const saldos = useQuery({ queryKey: ['saldos-gestora', perfil?.id], queryFn: listarSaldosGestora, enabled: !!perfil })
  const [form, setForm] = useState<Formulario>(null)
  const [empresa, setEmpresa] = useState<string | null>(null)
  const [filtroGrupo, setFiltroGrupo] = useState<Grupo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refrescar = () =>
    Promise.all([qc.invalidateQueries({ queryKey: clave }), qc.invalidateQueries({ queryKey: ['saldos-gestora'] })])

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

  const todos = consulta.data ?? []
  // Razones sociales con las que trabaja: las de sus saldos y las de sus trámites.
  const empresas = [
    ...new Map<string, string>([
      ...(saldos.data ?? []).map((s) => [s.empresa_id, s.empresa] as [string, string]),
      ...todos.map((t) => [t.empresa_id, t.operacion.empresa.nombre] as [string, string]),
    ]),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const tramites = empresa ? todos.filter((t) => t.empresa_id === empresa) : todos
  const saldosVisibles = (saldos.data ?? []).filter((s) => !empresa || s.empresa_id === empresa)
  const todosLosGrupos = GRUPOS.map((g) => ({ ...g, items: tramites.filter((t) => grupoDe(t) === g.id) }))
  const grupos = todosLosGrupos.filter((g) => g.items.length && (!filtroGrupo || g.id === filtroGrupo))
  const cerrar = () => setForm(null)
  const guardado = () => {
    setForm(null)
    void refrescar()
  }

  const nombre = perfil?.nombre?.split(' ')[0]
  const pendientes = todosLosGrupos.reduce((n, g) => n + g.items.length, 0)
  const bloqueados = tramites.filter((t) => t.situacion === 'sin_fondos').length

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <PageHeader
        rotulo="Gestoría · Tu jornada"
        titulo={nombre ? `Hola, ${nombre}` : 'Mis trámites'}
        descripcion="Tus trámites, la plata disponible y lo que tenés que hacer ahora."
      />

      {empresas.length > 1 && (
        <div role="group" aria-label="Razón social" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {[[null, 'Todas'] as [string | null, string], ...empresas].map(([id, nom]) => (
            <button
              key={id ?? 'todas'}
              type="button"
              aria-pressed={empresa === id}
              onClick={() => setEmpresa(id)}
              className={cx(
                'h-10 shrink-0 rounded-full px-4 text-[14px] font-medium ring-1 transition-colors',
                empresa === id ? 'bg-marca text-superficie ring-marca' : 'bg-superficie text-tinta ring-linea hover:bg-hover',
              )}
            >
              {nom}
            </button>
          ))}
        </div>
      )}

      {saldosVisibles.length > 0 && (
        <section aria-label="Plata disponible" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {saldosVisibles.map((s) => {
            const negativo = esNegativo(s.disponible)
            return (
              <article
                key={s.empresa_id}
                aria-label={`Saldo ${s.empresa}`}
                className={cx(
                  '@container min-w-0 rounded-lg p-5 ring-1',
                  negativo ? 'bg-sinfondos-suave ring-sinfondos/30' : 'bg-marca text-superficie ring-marca',
                )}
              >
                <p className={cx('text-[13px] font-medium', negativo ? 'text-sinfondos' : 'text-white/65')}>
                  {s.empresa} · disponible
                </p>
                <p
                  data-testid="disponible"
                  className={cx(
                    'cifra mt-2 font-display text-[clamp(22px,11cqi,34px)] leading-none font-medium tracking-[-0.03em] whitespace-nowrap',
                    negativo && 'text-sinfondos',
                  )}
                >
                  {formatearPesos(s.disponible)}
                </p>
                <p className={cx('mt-3 text-[13px]', negativo ? 'text-tinta' : 'text-white/65')}>
                  Apartado para trámites:{' '}
                  <span data-testid="apartado" className="cifra font-semibold whitespace-nowrap">
                    {formatearPesos(s.comprometido)}
                  </span>
                </p>
              </article>
            )
          })}
        </section>
      )}

      {consulta.isSuccess && pendientes > 0 && (
        <nav
          aria-label="Resumen"
          className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-5 md:gap-3 md:px-0"
        >
          {todosLosGrupos.map((g) => {
            const n = g.items.length
            const Icono = ICONO_GRUPO[g.id]
            const activo = filtroGrupo === g.id
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={activo}
                disabled={!n}
                onClick={() => setFiltroGrupo(activo ? null : g.id)}
                className={cx(
                  'flex min-w-[132px] shrink-0 flex-col gap-2 rounded-lg px-4 py-3 text-left ring-1 transition-colors md:min-w-0',
                  activo
                    ? 'bg-marca text-superficie ring-marca'
                    : n
                      ? 'bg-superficie shadow-tarjeta ring-linea hover:ring-marca/40'
                      : 'bg-transparent text-tenue ring-linea',
                )}
              >
                <span className="flex items-center justify-between">
                  <Icono className={cx('size-[18px]', activo ? 'text-superficie' : n ? 'text-marca' : 'text-tenue')} />
                  <span className="cifra font-display text-[26px] leading-none font-semibold">{n}</span>
                </span>
                <span className="text-[13px] font-semibold">{g.titulo}</span>
              </button>
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
            No los presentes hasta que la empresa cargue fondos.
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
      {consulta.isSuccess && !pendientes && (
        <EmptyState
          icono={<IconoCheck className="size-6" />}
          titulo="Estás al día"
          descripcion={
            empresa
              ? 'No tenés trámites pendientes de esta razón social.'
              : 'No tenés trámites pendientes. Cuando te asignen uno, aparece acá.'
          }
        />
      )}
      <div className="space-y-9 xl:grid xl:grid-cols-3 xl:items-start xl:gap-6 xl:space-y-0">
        {grupos.map((g) => {
          const Icono = ICONO_GRUPO[g.id]
          return (
            <section key={g.id} aria-labelledby={`grupo-${g.id}`} id={`seccion-${g.id}`} className="scroll-mt-20">
              <h2 id={`grupo-${g.id}`} className="mb-3 flex items-center gap-2.5 text-[20px] font-semibold tracking-tight">
                <span aria-hidden className="grid size-8 place-items-center rounded-md bg-marca-suave text-marca">
                  <Icono className="size-[18px]" />
                </span>
                {g.titulo}
                <span className="cifra ml-auto rounded-full bg-hundido px-2.5 py-0.5 text-[13px] font-semibold text-tenue" aria-hidden="true">
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
