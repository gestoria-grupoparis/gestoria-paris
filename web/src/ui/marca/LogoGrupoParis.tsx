import logo from './grupo-paris.svg?raw'
import { cx } from '../cx'

// Trazado vectorial exacto del logo original (web/public/brand/grupo-paris-logo.png): las partes blancas.
const ARTE = logo.replace(/<title>.*?<\/title>/s, '').replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')

type Props = { className?: string; titulo?: string }

/** Arte del logo en currentColor, sin fondo. Se usa como marca de agua. */
export function Monograma({ className, titulo = 'Grupo Paris' }: Props) {
  return <span role={titulo ? 'img' : undefined} aria-label={titulo || undefined} aria-hidden={titulo ? undefined : true} className={cx('block', className)} dangerouslySetInnerHTML={{ __html: ARTE }} />
}

/**
 * Logo oficial como "tarjeta de presentación": rectángulo negro con el logo blanco, igual al original.
 * Lleva un borde sutil para que contraste también sobre fondos oscuros. La altura la define className (h-*).
 */
export function LogoGrupoParis({ className }: { variante?: 'horizontal' | 'apilado'; tono?: 'claro' | 'oscuro'; className?: string }) {
  return (
    <span role="img" aria-label="Grupo Paris" className={cx('relative inline-block aspect-square shrink-0 rounded-[22%] bg-black text-white shadow-[0_1px_2px_rgba(0,0,0,.4)] ring-1 ring-white/20', className)}>
      <span aria-hidden className="absolute inset-[12%] block" dangerouslySetInnerHTML={{ __html: ARTE }} />
    </span>
  )
}
