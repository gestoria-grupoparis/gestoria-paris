import { formatearPesos } from '../../lib/dinero'
import { CLASE_PRIMARIO, CLASE_SECUNDARIO } from '../tramites/Dialogo'
import type { Grupo, TramiteGestora } from './consultas'

export type AccionGestora = 'presupuesto' | 'presentado' | 'pago' | 'finalizado' | 'retirado'

const SITUACION: Record<string, string> = {
  pagado: 'Pagado',
  pagado_parcial: 'Pago parcial',
  comprometido: 'Presupuestado, sin pagar',
}

const BOTON = 'w-full py-3 text-base'

export function TarjetaTramite({ t, grupo, ocupado, onAccion }: {
  t: TramiteGestora
  grupo: Grupo
  ocupado: boolean
  onAccion: (a: AccionGestora) => void
}) {
  const sinFondos = t.situacion === 'sin_fondos'
  const pagado = t.situacion === 'pagado'
  const tituloId = `tarjeta-${t.id}`
  return (
    <article
      aria-labelledby={tituloId}
      className={`border border-linea bg-white ${sinFondos ? 'border-l-4 border-l-alerta' : ''}`}
    >
      {sinFondos && (
        <p role="alert" className="bg-alerta px-3 py-2 text-sm font-semibold text-white">
          No presentar: sin fondos
        </p>
      )}
      <div className="space-y-1 px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id={tituloId} className="text-base font-semibold">
            {t.operacion.cliente_nombre}
            <span className="sr-only"> {t.numero}</span>
          </h3>
          <span className="text-xs text-tenue" aria-hidden="true">{t.numero}</span>
        </div>
        <p className="text-sm">{t.vehiculo_desc}</p>
        <p className="flex flex-wrap gap-x-3 text-sm text-tenue">
          <span className="font-medium tracking-wide text-tinta">{t.dominio ?? 'Sin dominio'}</span>
          <span>{t.operacion.empresa.nombre}</span>
          <span>Registro de {t.operacion.sucursal.provincia}</span>
        </p>
        {t.presupuesto && (
          <p className="flex justify-between pt-1 text-sm">
            <span className="text-tenue">Presupuesto</span>
            <span data-testid="presupuesto" className="font-semibold">{formatearPesos(t.presupuesto)}</span>
          </p>
        )}
        {SITUACION[t.situacion] && (
          <p className="text-sm">
            <span data-testid="situacion" className={`font-medium ${pagado ? 'text-emerald-700' : 'text-tenue'}`}>
              {SITUACION[t.situacion]}
            </span>
          </p>
        )}
      </div>
      <div className="grid gap-2 px-3 pb-3">
        {grupo === 'presupuestar' && (
          <button className={`${CLASE_PRIMARIO} ${BOTON}`} disabled={ocupado} onClick={() => onAccion('presupuesto')}>
            Cargar presupuesto
          </button>
        )}
        {grupo === 'listos' && (
          <button
            className={`${CLASE_PRIMARIO} ${BOTON}`}
            disabled={ocupado || sinFondos}
            onClick={() => onAccion('presentado')}
          >
            Marcar presentado
          </button>
        )}
        {grupo !== 'presupuestar' && !pagado && (
          <button
            className={`${grupo === 'listos' ? CLASE_SECUNDARIO : CLASE_PRIMARIO} ${BOTON}`}
            disabled={ocupado}
            onClick={() => onAccion('pago')}
          >
            Registrar pago
          </button>
        )}
        {grupo === 'presentados' && (
          <button className={`${CLASE_SECUNDARIO} ${BOTON}`} disabled={ocupado} onClick={() => onAccion('finalizado')}>
            Marcar finalizado
          </button>
        )}
        {grupo === 'retirar' && (
          <button className={`${CLASE_PRIMARIO} ${BOTON}`} disabled={ocupado} onClick={() => onAccion('retirado')}>
            Marcar retirado
          </button>
        )}
      </div>
    </article>
  )
}
