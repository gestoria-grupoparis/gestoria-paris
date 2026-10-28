import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSesion } from '../lib/sesion'
import { cargarUsuarios, etiquetaRol, filtrarUsuarios, ROLES, type Usuario } from '../features/usuarios/usuarios'
import { Button, Card, Cargando, Chip, claseControl, cx, DataTable, EmptyState, ErrorState, PageHeader, type TonoChip } from '../ui'
import { IconoBuscar, IconoEscudo } from '../ui/Iconos'

const TONO_ROL: Record<string, TonoChip> = {
  gerencia: 'solido',
  contable: 'marca',
  gestora: 'info',
  comercial: 'comprometido',
  admin: 'neutro',
}

function iniciales(nombre: string) {
  return nombre.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

function Avatar({ u }: { u: Usuario }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold',
        u.activo ? 'bg-hundido text-tinta ring-1 ring-linea-fuerte/70' : 'bg-hundido text-tenue',
      )}
    >
      {iniciales(u.nombre)}
    </span>
  )
}

function Alcances({ u }: { u: Usuario }) {
  if (u.rol === 'gestora') return <span className="text-[13px] text-tenue">Solo los trámites que tiene asignados</span>
  if (u.rol === 'admin') return <span className="text-[13px] text-tenue">No opera trámites</span>
  if (u.alcances.length === 0)
    return <span className="text-[13px] font-semibold text-comprometido">Sin alcance: no ve ninguna razón social</span>
  return (
    <ul className="flex flex-col gap-1">
      {u.alcances.map((a) => (
        <li key={a.empresa} className="text-[13px] leading-snug">
          <span className="font-semibold text-tinta">{a.empresa}</span>
          <span className="text-tenue"> · {a.detalle}</span>
        </li>
      ))}
    </ul>
  )
}

function Estado({ u }: { u: Usuario }) {
  return u.activo ? <Chip tono="disponible">Activo</Chip> : <Chip tono="apagado">Inactivo</Chip>
}

export function Usuarios() {
  const { perfil } = useSesion()
  const [texto, setTexto] = useState('')
  const [rol, setRol] = useState('')
  const consulta = useQuery({ queryKey: ['usuarios'], queryFn: cargarUsuarios, staleTime: 60_000 })
  const visibles = useMemo(() => filtrarUsuarios(consulta.data ?? [], texto, rol), [consulta.data, texto, rol])

  const total = consulta.data?.length ?? 0
  const activos = consulta.data?.filter((u) => u.activo).length ?? 0
  const porRol = (r: string) => consulta.data?.filter((u) => u.rol === r && u.activo).length ?? 0
  const limpiar = () => {
    setTexto('')
    setRol('')
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 pb-10 md:px-8 md:pt-8">
      <PageHeader
        rotulo="Administración"
        titulo="Usuarios y permisos"
        descripcion="Quién entra a la app, con qué rol y sobre qué razones sociales y sucursales trabaja."
      />

      {consulta.isError ? (
        <ErrorState
          titulo="No se pudieron cargar los usuarios"
          descripcion="Revisá la conexión y probá de nuevo."
          accion={
            <Button variante="secundario" tamano="sm" className="self-start" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : !consulta.data ? (
        <Cargando filas={5} etiqueta="Cargando usuarios…" />
      ) : (
        <>
          <section aria-label="Resumen por rol" className="mb-6 grid grid-cols-3 gap-3 md:grid-cols-4">
            <div className="col-span-3 flex items-end justify-between gap-3 rounded-lg bg-noche p-5 text-superficie shadow-tarjeta md:col-span-1 md:flex-col md:items-start">
              <span className="text-[12px] font-medium text-white/60">Usuarios activos</span>
              <span className="cifra font-display text-[40px] leading-none font-semibold md:text-[48px]">
                {activos}
                <span className="ml-2 align-middle text-[14px] font-medium text-superficie/70">de {total}</span>
              </span>
            </div>
            {(['gerencia', 'contable', 'gestora'] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rol === r}
                onClick={() => setRol(rol === r ? '' : r)}
                className={cx(
                  'flex min-h-[44px] flex-col items-start gap-2 rounded-lg p-4 text-left shadow-tarjeta ring-1 transition-colors md:p-5',
                  rol === r ? 'bg-marca-suave ring-marca' : 'bg-superficie ring-linea hover:ring-linea-fuerte',
                )}
              >
                <span className="rotulo">{etiquetaRol(r)}</span>
                <span className="cifra font-display text-[28px] leading-none font-semibold text-tinta">{porRol(r)}</span>
                <span className="hidden text-[12px] leading-snug text-tenue md:block">{ROLES.find((x) => x.id === r)?.descripcion}</span>
              </button>
            ))}
          </section>

          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Buscar usuario</span>
              <IconoBuscar className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-tenue" />
              <input
                type="search"
                aria-label="Buscar usuario"
                placeholder="Buscar por nombre o razón social"
                className={cx(claseControl, 'h-12 pl-10 text-[14px] shadow-tarjeta')}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </label>
            <select aria-label="Rol" className={cx(claseControl, 'h-12 shadow-tarjeta sm:w-56')} value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="">Todos los roles</option>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>

          {visibles.length === 0 ? (
            <EmptyState
              titulo="Ningún usuario coincide"
              descripcion="Probá con otro nombre o quitá el filtro de rol."
              accion={
                <Button variante="secundario" tamano="sm" onClick={limpiar}>
                  Limpiar búsqueda
                </Button>
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable aria-label="Usuarios">
                  <thead>
                    <tr>
                      <th scope="col">Persona</th>
                      <th scope="col">Rol</th>
                      <th scope="col">Alcance</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((u) => (
                      <tr key={u.id} className={cx(!u.activo && 'opacity-70')}>
                        <td className="!py-3">
                          <div className="flex items-center gap-3">
                            <Avatar u={u} />
                            <div className="leading-tight">
                              <div className="font-semibold text-tinta">{u.nombre}</div>
                              {u.id === perfil?.id && <div className="mt-0.5 text-[12px] text-tenue">Sos vos</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <Chip tono={TONO_ROL[u.rol]} punto={false}>
                            {etiquetaRol(u.rol)}
                          </Chip>
                        </td>
                        <td className="!py-3">
                          <Alcances u={u} />
                        </td>
                        <td>
                          <Estado u={u} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              <ul aria-label="Usuarios (lista)" className="flex flex-col gap-3 md:hidden">
                {visibles.map((u) => (
                  <li key={u.id}>
                    <Card className={cx('p-4', !u.activo && 'opacity-75')}>
                      <div className="flex items-center gap-3">
                        <Avatar u={u} />
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="truncate font-semibold text-tinta">{u.nombre}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Chip tono={TONO_ROL[u.rol]} punto={false}>
                              {etiquetaRol(u.rol)}
                            </Chip>
                            <Estado u={u} />
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-linea pt-3">
                        <div className="rotulo mb-1">Alcance</div>
                        <Alcances u={u} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}

          <Card plana className="mt-6 flex items-start gap-3 p-4 md:p-5">
            <IconoEscudo className="mt-0.5 size-6 text-marca" />
            <p className="text-[14px] leading-relaxed text-tenue">
              <span className="font-semibold text-tinta">Pantalla de consulta.</span> Por ahora las altas, los cambios de rol o de
              alcance y las bajas se piden a soporte técnico, y quedan registrados en el historial de auditoría.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
