import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { formatearPesos } from '../lib/dinero'
import { listarSaldos } from '../features/habitualista/consultas'
import { useFinanzasEnVivo } from '../features/habitualista/enVivo'
import { necesidadRecarga } from '../features/habitualista/saldos'
import { contarPorEstado, listarIntervencion, type Motivo } from '../features/tablero/consultas'
import { ESTADOS } from '../features/tramites/filtros'

const MOTIVOS: Record<Motivo, string> = {
  observado: 'Observado',
  sin_fondos: 'Sin fondos',
  demorado: 'Autorizado hace más de 5 días hábiles sin presentar',
}

const TH = 'border-b border-linea px-2 py-1.5 text-xs font-medium text-tenue whitespace-nowrap'
const TD = 'border-b border-linea px-2 py-1.5 text-right whitespace-nowrap'

const Pesos = ({ cents, id, alerta = false }: { cents: string; id: string; alerta?: boolean }) => (
  <td data-testid={id} className={`${TD} ${alerta ? 'font-semibold text-alerta' : ''}`}>{formatearPesos(cents)}</td>
)

export function Tablero() {
  useFinanzasEnVivo('tablero-pantalla', 'tablero')
  const saldos = useQuery({ queryKey: ['tablero', 'saldos'], queryFn: listarSaldos })
  const conteo = useQuery({ queryKey: ['tablero', 'conteo'], queryFn: contarPorEstado })
  const intervencion = useQuery({ queryKey: ['tablero', 'intervencion'], queryFn: listarIntervencion })

  return (
    <div className="space-y-5 px-4 py-3">
      <h1 className="text-lg font-semibold">Tablero</h1>

      <section aria-labelledby="t-saldos">
        <h2 id="t-saldos" className="mb-1 text-sm font-semibold">Fondos por razón social</h2>
        {saldos.isError ? (
          <p role="alert" className="text-sm text-alerta">No se pudieron cargar los saldos.</p>
        ) : !saldos.data ? (
          <p className="text-sm text-tenue">Cargando saldos…</p>
        ) : (
          <div className="overflow-x-auto border border-linea bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Razón social</th>
                  <th className={`${TH} text-right`}>Registrado</th>
                  <th className={`${TH} text-right`}>Comprometido</th>
                  <th className={`${TH} text-right`}>Disponible</th>
                  <th className={`${TH} text-right`}>Necesidad de recarga</th>
                </tr>
              </thead>
              <tbody>
                {saldos.data.map((s) => {
                  const recarga = necesidadRecarga(s.disponible)
                  return (
                    <tr key={s.cuenta_id}>
                      <th scope="row" className="border-b border-linea px-2 py-1.5 text-left font-medium">
                        <Link to={`/habitualista?empresa=${s.empresa_id}`} className="hover:underline">{s.empresa}</Link>
                      </th>
                      <Pesos id="registrado" cents={s.registrado} />
                      <Pesos id="comprometido" cents={s.comprometido} />
                      <Pesos id="disponible" cents={s.disponible} alerta={s.disponible.startsWith('-')} />
                      <Pesos id="recarga" cents={recarga} alerta={recarga !== '0'} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="t-estados">
        <h2 id="t-estados" className="mb-1 text-sm font-semibold">Trámites por estado</h2>
        {conteo.data && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {ESTADOS.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/tramites?estado=${e.id}`}
                  className={`inline-flex items-baseline gap-2 border px-2 py-1 hover:border-marca ${
                    conteo.data[e.id] ? 'border-linea bg-white' : 'border-transparent text-tenue'
                  }`}
                >
                  <span>{e.etiqueta}</span>{' '}
                  <strong className="text-base">{conteo.data[e.id] ?? 0}</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="t-intervencion">
        <h2 id="t-intervencion" className="mb-1 text-sm font-semibold">Requieren intervención</h2>
        {intervencion.isError ? (
          <p role="alert" className="text-sm text-alerta">No se pudo cargar la lista.</p>
        ) : !intervencion.data ? (
          <p className="text-sm text-tenue">Cargando…</p>
        ) : intervencion.data.length === 0 ? (
          <p className="text-sm text-tenue">Nada pendiente: no hay observados, sin fondos ni demorados.</p>
        ) : (
          <ul aria-label="Requieren intervención" className="divide-y divide-linea border border-linea bg-white text-sm">
            {intervencion.data.map((t) => (
              <li key={t.id}>
                <Link to={`/tramites?t=${t.id}`} className="flex flex-wrap gap-x-3 px-3 py-1.5 hover:bg-fondo">
                  <span className="font-medium">{t.numero}</span>
                  <span>{t.cliente}</span>
                  <span className="text-tenue">{t.empresa}</span>
                  <span className="ml-auto text-alerta">{t.motivos.map((m) => MOTIVOS[m]).join(', ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
