import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSesion } from '../lib/sesion'
import { mensajeError } from '../lib/errores'
import { cambiarEstado, marcar } from '../features/tramites/consultas'
import { GRUPOS, grupoDe, listarMisTramites, type TramiteGestora } from '../features/gestora/consultas'
import { TarjetaTramite, type AccionGestora } from '../features/gestora/TarjetaTramite'
import { FormPresupuesto } from '../features/gestora/FormPresupuesto'
import { FormPago } from '../features/gestora/FormPago'

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

  return (
    <div className="mx-auto max-w-xl px-4 py-4">
      <h1 className="mb-3 text-lg font-semibold">Mis trámites</h1>
      {error && (
        <p role="alert" className="mb-3 border border-alerta bg-white px-3 py-2 text-sm text-alerta">{error}</p>
      )}
      {consulta.isPending && <p className="text-sm text-tenue">Cargando…</p>}
      {consulta.isError && <p role="alert" className="text-sm text-alerta">{mensajeError(consulta.error)}</p>}
      {consulta.isSuccess && !grupos.length && (
        <p className="text-sm text-tenue">No tenés trámites pendientes. Cuando te asignen uno, aparece acá.</p>
      )}
      <div className="space-y-6">
        {grupos.map((g) => (
          <section key={g.id} aria-labelledby={`grupo-${g.id}`}>
            <h2
              id={`grupo-${g.id}`}
              className="mb-2 flex items-baseline justify-between border-b-2 border-tinta pb-1 text-base font-semibold"
            >
              {g.titulo}
              <span className="text-sm font-normal text-tenue" aria-hidden="true">{g.items.length}</span>
            </h2>
            <div className="space-y-3">
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
        ))}
      </div>
      {form?.tipo === 'presupuesto' && <FormPresupuesto tramite={form.t} onCerrar={cerrar} onGuardado={guardado} />}
      {form?.tipo === 'pago' && <FormPago tramite={form.t} onCerrar={cerrar} onGuardado={guardado} />}
    </div>
  )
}
