import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconoCerrar } from './Iconos'

const ENFOCABLES =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal: hoja inferior en el teléfono, tarjeta centrada en escritorio.
 * Foco inicial en el primer campo (sólo al montar), trampa de foco, devuelve el foco al cerrar,
 * bloquea el scroll y deja inerte el resto de la app. Con `bloqueado` (envío en curso) no se cierra.
 */
export function Dialogo({
  titulo,
  rotulo,
  onCerrar,
  children,
  ancho = 'md:max-w-lg',
  bloqueado = false,
  sucio = false,
}: {
  titulo: string
  rotulo?: ReactNode
  onCerrar: () => void
  children: ReactNode
  ancho?: string
  bloqueado?: boolean
  sucio?: boolean
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const estado = useRef({ onCerrar, bloqueado, sucio })
  estado.current = { onCerrar, bloqueado, sucio }

  const cerrar = (desdeFondo = false) => {
    const s = estado.current
    if (s.bloqueado) return
    if (desdeFondo && s.sucio && !window.confirm('¿Descartar lo que escribiste?')) return
    s.onCerrar()
  }
  const cerrarRef = useRef(cerrar)
  cerrarRef.current = cerrar

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const raiz = document.getElementById('root')
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    raiz?.setAttribute('inert', '')
    const primero = ref.current?.querySelector<HTMLElement>('input,select,textarea') ?? ref.current?.querySelector<HTMLElement>(ENFOCABLES)
    primero?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cerrarRef.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const lista = Array.from(ref.current.querySelectorAll<HTMLElement>(ENFOCABLES))
      if (!lista.length) return
      const [a, z] = [lista[0], lista[lista.length - 1]]
      if (e.shiftKey && (document.activeElement === a || !ref.current.contains(document.activeElement))) {
        e.preventDefault()
        z.focus()
      } else if (!e.shiftKey && (document.activeElement === z || !ref.current.contains(document.activeElement))) {
        e.preventDefault()
        a.focus()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = overflow
      raiz?.removeAttribute('inert')
      if (previo && document.contains(previo)) previo.focus()
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-noche/55 md:items-center md:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && cerrar(true)}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-busy={bloqueado || undefined}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-superficie shadow-flotante md:rounded-xl ${ancho}`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-linea bg-superficie/95 px-5 pt-5 pb-4 backdrop-blur md:px-6">
          <div className="min-w-0">
            {rotulo && <div className="rotulo mb-1">{rotulo}</div>}
            <h2 id={id} className="text-[22px] leading-tight font-semibold">
              {titulo}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => cerrar()}
            disabled={bloqueado}
            className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-md text-tenue hover:bg-hundido hover:text-tinta disabled:opacity-40"
          >
            <IconoCerrar />
          </button>
        </div>
        <div className="px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
