import { useQuery } from '@tanstack/react-query'
import { formatearPesos } from '../../lib/dinero'
import { Button, Cargando, Chip, DataTable, ErrorState, celdaMonto, celdaPrincipal } from '../../ui'
import { IconoAlerta } from '../../ui/Iconos'
import { obtenerPrevision } from './consultas'
import { aNumero, etiquetaSemana } from './formato'
import { GraficoLineas } from './Graficos'

/** Previsión semanal de fondos: pipeline confirmado + proyección por historial (orientativa). */
export function Prevision({ hoy, empresa }: { hoy: string; empresa: string | null }) {
  const q = useQuery({ queryKey: ['analisis', 'prevision', hoy, empresa], queryFn: () => obtenerPrevision(hoy, empresa) })
  if (q.isError)
    return <ErrorState titulo="No se pudo calcular la previsión." accion={<Button variante="secundario" tamano="sm" className="w-fit" onClick={() => void q.refetch()}>Reintentar</Button>} />
  if (!q.data) return <Cargando etiqueta="Calculando la previsión…" />
  const p = q.data
  const datos = p.semanas.map((s) => ({
    semana: etiquetaSemana(s.semana),
    previsto: aNumero(s.previsto_cents),
    pipeline: aNumero(s.pipeline_cents),
    alto: s.alto_cents == null ? null : aNumero(s.alto_cents),
  }))
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-hundido px-4 py-3 text-[13px] text-tenue" data-testid="aviso-prevision">
        {p.suficiente ? (
          <>Previsión orientativa con {p.semanas_historia} semanas de historia. Lo que ya está en curso no se suma dos veces: cada semana toma el mayor entre lo confirmado y lo proyectado.</>
        ) : (
          <><strong className="text-tinta">Historia insuficiente:</strong> hay {p.semanas_historia} {p.semanas_historia === 1 ? 'semana' : 'semanas'} de pagos y hacen falta 4 para proyectar. Por ahora solo se muestra lo confirmado.</>
        )}
        {p.sin_monto > 0 && <> {p.sin_monto} {p.sin_monto === 1 ? 'trámite en curso no tiene' : 'trámites en curso no tienen'} presupuesto ni estimado y no suman.</>}
      </p>

      <GraficoLineas
        titulo="Fondos previstos por semana"
        rotulo="Próximas 4 semanas"
        datos={datos}
        x="semana"
        series={[
          { clave: 'previsto', nombre: 'Previsto (base)' },
          { clave: 'pipeline', nombre: 'Confirmado en curso', color: 'var(--color-acento)' },
          ...(p.suficiente ? [{ clave: 'alto', nombre: 'Escenario alto', color: 'var(--color-comprometido)', punteada: true }] : []),
        ]}
        vacio="No hay trámites en curso ni historia para prever."
      />

      <DataTable aria-label="Saldo contra lo previsto">
        <thead>
          <tr>
            <th>Razón social</th>
            <th className="text-right">Saldo registrado</th>
            <th className="text-right">Disponible</th>
            <th className="text-right">1 semana</th>
            <th className="text-right">2 semanas</th>
            <th className="text-right">4 semanas</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {p.saldos.map((s) => (
            <tr key={s.empresa_id}>
              <td className={celdaPrincipal}>{s.empresa}</td>
              <td className={celdaMonto}>{formatearPesos(s.registrado_cents)}</td>
              <td className={celdaMonto}>{formatearPesos(s.disponible_cents)}</td>
              <td className={celdaMonto}>{formatearPesos(s.previsto_1_cents)}</td>
              <td className={celdaMonto}>{formatearPesos(s.previsto_2_cents)}</td>
              <td className={celdaMonto}>{formatearPesos(s.previsto_4_cents)}</td>
              <td>
                {s.alerta ? (
                  <Chip tono="sinfondos" punto={false}><IconoAlerta className="size-3.5" /> No alcanza</Chip>
                ) : (
                  <Chip tono="disponible">Alcanza</Chip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  )
}
