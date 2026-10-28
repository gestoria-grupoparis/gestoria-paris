import type { ReactNode } from 'react'
import { cx } from './cx'

/** Íconos de trazo (24x24, estilo lineal) usados en pantallas operativas. Decorativos: aria-hidden. */
function Base({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cx('size-5 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

type P = { className?: string }
export const IconoMas = (p: P) => <Base {...p}><path d="M12 5v14M5 12h14" /></Base>
export const IconoBuscar = (p: P) => <Base {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Base>
export const IconoFiltros = (p: P) => <Base {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Base>
export const IconoCerrar = (p: P) => <Base {...p}><path d="M6 6l12 12M18 6 6 18" /></Base>
export const IconoAuto = (p: P) => <Base {...p}><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v2H3zM5 11h14" /><circle cx="7.5" cy="13.5" r=".6" /><circle cx="16.5" cy="13.5" r=".6" /></Base>
export const IconoCheck = (p: P) => <Base {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Base>
export const IconoUsuario = (p: P) => <Base {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" /></Base>
export const IconoOjo = (p: P) => <Base {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" /></Base>
export const IconoAlerta = (p: P) => <Base {...p}><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.1" /></Base>
export const IconoReloj = (p: P) => <Base {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Base>
export const IconoPausa = (p: P) => <Base {...p}><path d="M9 6v12M15 6v12" /></Base>
export const IconoPlay = (p: P) => <Base {...p}><path d="M8 5.5v13l10-6.5z" /></Base>
export const IconoDoc = (p: P) => <Base {...p}><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" /><path d="M14 3.5V8h4M10 13h5M10 16.5h5" /></Base>
export const IconoFlecha = (p: P) => <Base {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Base>
export const IconoChevron = (p: P) => <Base {...p}><path d="m9 6 6 6-6 6" /></Base>
export const IconoProhibido = (p: P) => <Base {...p}><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></Base>
export const IconoDescarga = (p: P) => <Base {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Base>
export const IconoEscudo = (p: P) => <Base {...p}><path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="m9 12 2 2 4-4" /></Base>
