import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useSesion } from '../../lib/sesion'
import { Chip, cx } from '../../ui'
import { useMarcarLeidas, useNotificaciones, type Notificacion } from './consultas'
import { destinoNotificacion, haceCuanto, noLeidas, TIPO_NOTIFICACION } from './formato'

function IconoCampana({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  )
}

/** Campana del shell: contador de no leídas y panel con las últimas notificaciones (en vivo). */
export function Campana({ tono }: { tono: 'oscuro' | 'claro' }) {
  const { perfil, rol } = useSesion()
  const { data = [], isError } = useNotificaciones(perfil?.id)
  const marcar = useMarcarLeidas()
  const navegar = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)
  const pendientes = noLeidas(data)

  useEffect(() => {
    if (!abierto) return
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAbierto(false); boton.current?.focus() }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [abierto])

  const abrir = (n: Notificacion) => {
    if (!n.leida_at) marcar.mutate([n.id])
    const destino = destinoNotificacion(rol, n.tramite_id)
    setAbierto(false)
    if (destino) navegar(destino)
  }

  const etiqueta = pendientes ? `Notificaciones, ${pendientes} sin leer` : 'Notificaciones'

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        onClick={() => setAbierto((a) => !a)}
        className={cx(
          'relative grid size-10 place-items-center rounded-md transition-colors',
          tono === 'oscuro' ? 'text-white/60 hover:bg-white/[0.06] hover:text-white' : 'text-tenue hover:bg-hover hover:text-tinta',
          abierto && (tono === 'oscuro' ? 'bg-white/[0.08] text-white' : 'bg-hover text-tinta'),
        )}
      >
        <IconoCampana />
        {pendientes > 0 && (
          <span
            data-testid="contador-notificaciones"
            className={cx(
              'absolute top-1 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-sinfondos px-1 text-[10.5px] font-semibold tabular-nums leading-none text-white ring-2',
              tono === 'oscuro' ? 'ring-noche' : 'ring-superficie',
            )}
          >
            {pendientes > 9 ? '9+' : pendientes}
          </span>
        )}
      </button>

      {abierto && createPortal(
        <div className="fixed inset-0 z-50">
          <button type="button" aria-label="Cerrar notificaciones" tabIndex={-1} className="absolute inset-0 cursor-default bg-noche/30 md:bg-transparent" onClick={() => setAbierto(false)} />
          <div
            role="dialog"
            aria-label="Notificaciones"
            className="absolute inset-x-3 top-16 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-linea bg-superficie text-tinta shadow-flotante md:inset-x-auto md:top-4 md:left-[252px] md:w-[400px] md:max-h-[calc(100dvh-2rem)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-linea px-4 py-3">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Notificaciones</h2>
                <p className="text-[12.5px] text-tenue">
                  {pendientes ? (pendientes === 1 ? '1 sin leer' : `${pendientes} sin leer`) : 'Estás al día'}
                </p>
              </div>
              {pendientes > 0 && (
                <button
                  type="button"
                  onClick={() => marcar.mutate(null)}
                  className="h-8 rounded-md px-2.5 text-[13px] font-medium text-tenue hover:bg-hover hover:text-tinta"
                >
                  Marcar todas como leídas
                </button>
              )}
            </div>
            {isError ? (
              <p className="px-4 py-10 text-center text-sm text-tenue">No pudimos cargar las notificaciones. Probá de nuevo en un rato.</p>
            ) : data.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-hundido text-tenue"><IconoCampana className="size-5" /></span>
                <p className="mt-3 text-sm font-medium">No tenés notificaciones</p>
                <p className="mt-1 text-[13px] text-tenue">Te avisamos acá cuando te asignen un trámite, lo observen o falten fondos.</p>
              </div>
            ) : (
              <ul className="overflow-y-auto overscroll-contain py-1">
                {data.map((n) => {
                  const tipo = TIPO_NOTIFICACION[n.tipo]
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => abrir(n)}
                        aria-label={`${n.leida_at ? '' : 'Sin leer: '}${n.mensaje}`}
                        className={cx(
                          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-hover',
                          !n.leida_at && 'bg-info-suave/40',
                        )}
                      >
                        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.leida_at ? 'bg-transparent' : 'bg-acento')} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Chip tono={tipo?.tono ?? 'neutro'}>{tipo?.etiqueta ?? n.tipo}</Chip>
                            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-tenue">{haceCuanto(n.created_at)}</span>
                          </span>
                          <span className={cx('mt-1.5 block text-[13.5px] leading-snug', n.leida_at ? 'text-tenue' : 'font-medium')}>{n.mensaje}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
