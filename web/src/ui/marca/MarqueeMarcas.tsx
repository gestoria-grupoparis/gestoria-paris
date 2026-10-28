import peugeot from './marcas/peugeot.svg?raw'
import citroen from './marcas/citroen.svg?raw'
import chevrolet from './marcas/chevrolet.svg?raw'
import honda from './marcas/honda.svg?raw'
import jetour from './marcas/jetour.svg?raw'
import dfsk from './marcas/dfsk.svg?raw'
import kyc from './marcas/kyc.svg?raw'
import { cx } from '../cx'

/** Las 7 marcas que trabaja Grupo Paris. `alto` iguala el peso visual (emblemas vs. wordmarks). */
export const MARCAS_OFICIALES = [
  { nombre: 'Peugeot', svg: peugeot, alto: 'h-7' },
  { nombre: 'Citroën', svg: citroen, alto: 'h-7' },
  { nombre: 'Chevrolet', svg: chevrolet, alto: 'h-7' },
  { nombre: 'Honda Motos', svg: honda, alto: 'h-7' },
  { nombre: 'Jetour', svg: jetour, alto: 'h-[15px]' },
  { nombre: 'DFSK', svg: dfsk, alto: 'h-6' },
  { nombre: 'KYC', svg: kyc, alto: 'h-6' },
] as const

const sinTitulo = (svg: string) => svg.replace(/<title>.*?<\/title>/s, '')

function Pista() {
  return (
    <ul className="flex shrink-0 items-center">
      {MARCAS_OFICIALES.map((m) => (
        <li key={m.nombre} className={cx('marquee-logo mx-10 shrink-0 md:mx-14', m.alto)} dangerouslySetInnerHTML={{ __html: sinTitulo(m.svg) }} />
      ))}
    </ul>
  )
}

/**
 * Logo wall infinito: dos copias idénticas de la pista y animación a -50% (una copia exacta),
 * así el loop no tiene costura. Decorativo (aria-hidden); la lista accesible va aparte.
 * Pausa con hover y queda estático con prefers-reduced-motion (ver .marquee en index.css).
 */
export function MarqueeMarcas({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="sr-only">Marcas con las que trabajamos:</p>
      <ul className="sr-only">
        {MARCAS_OFICIALES.map((m) => <li key={m.nombre}>{m.nombre}</li>)}
      </ul>
      <div aria-hidden className="marquee overflow-hidden text-white/55">
        <div className="marquee-pista">
          <Pista />
          <Pista />
        </div>
      </div>
    </div>
  )
}
