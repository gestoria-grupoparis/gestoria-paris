import { useId } from 'react'

/**
 * Logo Grupo Paris recreado en SVG a partir de web/public/brand/grupo-paris-logo.png.
 * Monocromo: usa currentColor. El wordmark usa Michroma (sans extendida geométrica).
 */

type Props = { className?: string; titulo?: string }

/** Monograma: "P" calada en cuadrado redondeado con corte diagonal. */
export function Monograma({ className, titulo = 'Grupo Paris' }: Props) {
  const id = useId()
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={titulo} fill="currentColor">
      <defs>
        <mask id={id}>
          <rect width="100" height="100" fill="#fff" />
          {/* P: asta + panza con contraforma */}
          <path
            fill="#000"
            fillRule="evenodd"
            d="M24 16h36a20 20 0 0 1 20 20v6a20 20 0 0 1-20 20H41v24H24z M41 30v18h17a6 6 0 0 0 6-6v-6a6 6 0 0 0-6-6z"
          />
          {/* corte diagonal sobre el asta */}
          <path fill="#fff" d="M22 74l21-12v4L22 78z" />
          {/* corte diagonal de la esquina inferior derecha */}
          <path fill="#000" d="M64 100L100 70v5L70 100z" />
        </mask>
      </defs>
      <rect width="100" height="100" rx="14" mask={`url(#${id})`} />
    </svg>
  )
}

const FUENTE = "Michroma, 'Eurostile', 'Microgramma', sans-serif"

/**
 * Logo completo. tono="claro" = logo blanco (para fondos oscuros); "oscuro" = negro.
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
  const color = tono === 'claro' ? '#ffffff' : '#0a0a0a'
  if (variante === 'apilado') {
    return (
      <svg viewBox="0 0 200 210" className={className} role="img" aria-label="Grupo Paris" style={{ color }} fill="currentColor">
        <svg x="55" y="0" width="90" height="90"><MonogramaInterno /></svg>
        <text x="100" y="140" textAnchor="middle" fontFamily={FUENTE} fontSize="27" letterSpacing="1">GRUPO</text>
        <text x="100" y="192" textAnchor="middle" fontFamily={FUENTE} fontSize="42" letterSpacing="1">PARIS</text>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 330 80" className={className} role="img" aria-label="Grupo Paris" style={{ color }} fill="currentColor">
      <svg x="0" y="4" width="72" height="72"><MonogramaInterno /></svg>
      <text x="88" y="34" fontFamily={FUENTE} fontSize="20" letterSpacing="1">GRUPO</text>
      <text x="86" y="72" fontFamily={FUENTE} fontSize="34" letterSpacing="1">PARIS</text>
    </svg>
  )
}

function MonogramaInterno() {
  return <Monograma className="h-full w-full" titulo="" />
}
