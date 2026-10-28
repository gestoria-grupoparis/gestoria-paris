import peugeot from './marcas/peugeot.svg?raw'
import citroen from './marcas/citroen.svg?raw'
import chevrolet from './marcas/chevrolet.svg?raw'
import honda from './marcas/honda.svg?raw'
import jetour from './marcas/jetour.svg?raw'
import dfsk from './marcas/dfsk.svg?raw'
import kyc from './marcas/kyc.svg?raw'

/** Las 7 marcas que trabaja Grupo Paris. todas en la misma caja (alto y ancho fijos) para que pesen igual. */
export const MARCAS_OFICIALES = [
  { nombre: 'Peugeot', svg: peugeot },
  { nombre: 'Citroën', svg: citroen },
  { nombre: 'Chevrolet', svg: chevrolet },
  { nombre: 'Honda Motos', svg: honda },
  { nombre: 'Jetour', svg: jetour },
  { nombre: 'DFSK', svg: dfsk },
  { nombre: 'KYC', svg: kyc },
] as const

const sinTitulo = (svg: string) => svg.replace(/<title>.*?<\/title>/s, '')

function Pista() {
  return (
    <ul className="flex shrink-0 items-center">
      {MARCAS_OFICIALES.map((m) => (
        <li key={m.nombre} className={'marquee-logo mx-8 flex h-11 w-28 shrink-0 items-center justify-center md:mx-12 md:h-12 md:w-32'} dangerouslySetInnerHTML={{ __html: sinTitulo(m.svg) }} />
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
      <div aria-hidden className="marquee overflow-hidden text-white/75">
        <div className="marquee-pista">
          <Pista />
          <Pista />
        </div>
      </div>
    </div>
  )
}
