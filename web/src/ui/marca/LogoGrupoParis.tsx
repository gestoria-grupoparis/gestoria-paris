import { useId } from 'react'
import { cx } from '../cx'

// Logo dibujado a mano a partir del original (web/public/brand/grupo-paris-logo.png):
// cuadrado redondeado en currentColor con la "P" calada (deja ver el fondo), un corte diagonal
// fino en el asta y un chaflán en la esquina inferior derecha. Sobre fondo oscuro queda igual al original.
const FUENTE = "'Krona One', 'Eurostile Extended', 'Arial Black', sans-serif"

function Marca({ x = 0, y = 0, size = 100 }: { x?: number; y?: number; size?: number }) {
  const id = useId()
  return (
    <svg x={x} y={y} width={size} height={size * 0.92} viewBox="0 0 100 92">
      <mask id={id}>
        <rect width="100" height="92" rx="9" fill="white" />
        {/* P: asta + panza con contraforma */}
        <path
          fill="black"
          fillRule="evenodd"
          d="M15 10 H62 C76 10 85 20 85 34.5 C85 49 76 59.5 62 59.5 H33 V84 H15 Z
             M33 23.5 V46 H60 C66 46 69.5 41 69.5 34.75 C69.5 28.5 66 23.5 60 23.5 Z"
        />
        {/* corte diagonal del asta */}
        <path d="M13 67.5 L35 60.5" stroke="white" strokeWidth="2.2" />
        {/* chaflán de la esquina inferior derecha */}
        <path d="M70 94 L102 64" stroke="black" strokeWidth="2.6" />
      </mask>
      <rect width="100" height="92" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  )
}

type Props = { className?: string; titulo?: string }

/** Solo el isotipo (cuadrado con la P). */
export function Monograma({ className, titulo = 'Grupo Paris' }: Props) {
  return (
    <svg viewBox="0 0 100 92" className={className} role={titulo ? 'img' : undefined} aria-label={titulo || undefined} aria-hidden={titulo ? undefined : true} fill="currentColor">
      <Marca />
    </svg>
  )
}

/**
 * Logo completo, sin fondo. tono="claro" = blanco (fondos oscuros); "oscuro" = negro.
 * variante="apilado" replica el original; "horizontal" pone el texto a la derecha.
 */
export function LogoGrupoParis({
  variante = 'horizontal',
  tono = 'oscuro',
  className,
}: {
  variante?: 'horizontal' | 'apilado'
  tono?: 'claro' | 'oscuro'
  className?: string
}) {
  const color = tono === 'claro' ? '#ffffff' : '#0a0a0b'
  if (variante === 'apilado') {
    return (
      <svg viewBox="0 0 200 196" className={cx('w-auto', className)} role="img" aria-label="Grupo Paris" style={{ color }} fill="currentColor">
        <Marca x={50} y={0} size={100} />
        <text x="100" y="138" textAnchor="middle" fontFamily={FUENTE} fontSize="25" letterSpacing="1.5">GRUPO</text>
        <text x="100" y="188" textAnchor="middle" fontFamily={FUENTE} fontSize="40" letterSpacing="1">PARIS</text>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 250 66" className={cx('w-auto', className)} role="img" aria-label="Grupo Paris" style={{ color }} fill="currentColor">
      <Marca x={0} y={3} size={66} />
      <text x="80" y="27" fontFamily={FUENTE} fontSize="17" letterSpacing="1.5">GRUPO</text>
      <text x="79" y="60" fontFamily={FUENTE} fontSize="29" letterSpacing="0.5">PARIS</text>
    </svg>
  )
}
