import { useEffect, useId, useRef, useState } from 'react'
import { Button, type Tamano } from './Button'
import { cx } from './cx'
import { IconoChevron, IconoDescarga, IconoDoc } from './Iconos'

export type FormatoExportacion = 'xlsx' | 'csv'

const OPCIONES: { formato: FormatoExportacion; titulo: string; detalle: string }[] = [
  { formato: 'xlsx', titulo: 'Excel (.xlsx)', detalle: 'Montos como número, listos para sumar' },
  { formato: 'csv', titulo: 'CSV (.csv)', detalle: 'Texto separado por punto y coma' },
]

/** Botón "Exportar" con menú de formato. `onExportar` puede ser asíncrono: el botón queda cargando. */
export function MenuExportar({
  onExportar,
  disabled,
  title,
  tamano = 'md',
  alinear = 'derecha',
}: {
  onExportar: (formato: FormatoExportacion) => void | Promise<void>
  disabled?: boolean
  title?: string
  tamano?: Tamano
  alinear?: 'derecha' | 'izquierda'
}) {
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false) }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAbierto(false); boton.current?.focus() }
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    raiz.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const elegir = async (f: FormatoExportacion) => {
    setAbierto(false)
    setOcupado(true)
    setError(null)
    try {
      await onExportar(f)
    } catch {
      setError('No se pudo generar el archivo. Probá de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div ref={raiz} className="relative">
      <Button
        ref={boton}
        variante="secundario"
        tamano={tamano}
        icono={<IconoDescarga className="size-[18px]" />}
        disabled={disabled}
        cargando={ocupado}
        title={title}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        Exportar
        <IconoChevron className={cx('size-4 text-tenue', abierto ? '-rotate-90' : 'rotate-90')} />
      </Button>
      {abierto && (
        <div
          id={id}
          role="menu"
          aria-label="Formato de exportación"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const items = [...(raiz.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
            const i = items.indexOf(document.activeElement as HTMLButtonElement)
            items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
          }}
          className={cx(
            'absolute top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-superficie p-1.5 shadow-tarjeta ring-1 ring-linea',
            alinear === 'derecha' ? 'left-0 sm:right-0 sm:left-auto' : 'left-0',
          )}
        >
          {OPCIONES.map((o) => (
            <button
              key={o.formato}
              type="button"
              role="menuitem"
              onClick={() => void elegir(o.formato)}
              className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-acento"
            >
              <IconoDoc className="mt-0.5 size-[18px] shrink-0 text-tenue" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-tinta">{o.titulo}</span>
                <span className="text-[12px] text-tenue">{o.detalle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="absolute top-full left-0 mt-2 w-64 sm:right-0 sm:left-auto sm:text-right text-[12px] text-sinfondos">{error}</p>}
    </div>
  )
}
