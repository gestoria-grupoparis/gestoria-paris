-- Indicadores de fondos del Tablero desde una sola definicion (auditoria de interfaz, 2/11/2026).
-- v_saldos suma dos columnas al final (create or replace view solo admite agregar al final):
--   necesidad_recarga_cents: max(-disponible, 0), lo que falta cargar para cubrir lo comprometido.
--   tramites_sin_fondos: trámites de la cuenta con situacion 'sin_fondos' en v_tramite_finanzas_base,
--     la misma definicion que usan resumen_tablero y tramites_intervencion.
-- Asi la tarjeta de la razon social y el indicador "Trámites sin fondos" salen de la base y no se
-- contradicen. No edita migraciones anteriores.

create or replace view public.v_saldos with (security_invoker = false) as
select s.cuenta_id,
       s.empresa_id,
       e.nombre as empresa,
       s.registrado_cents,
       coalesce(comp.comprometido_cents, 0)::bigint as comprometido_cents,
       (s.registrado_cents - coalesce(comp.comprometido_cents, 0))::bigint as disponible_cents,
       um.created_at as ultimo_movimiento_at,
       um.creado_por as ultimo_movimiento_por,
       uc.fecha_corte as ultima_conciliacion_fecha,
       uc.diferencia_cents as ultima_diferencia_cents,
       greatest(-(s.registrado_cents - coalesce(comp.comprometido_cents, 0)), 0)::bigint as necesidad_recarga_cents,
       coalesce(comp.tramites_sin_fondos, 0)::int as tramites_sin_fondos
  from public.v_saldo_registrado_base s
  join public.empresas e on e.id = s.empresa_id
  left join lateral (
    select sum(f.comprometido_cents) as comprometido_cents,
           count(*) filter (where f.situacion = 'sin_fondos') as tramites_sin_fondos
      from public.v_tramite_finanzas_base f
     where f.cuenta_id = s.cuenta_id
  ) comp on true
  left join lateral (
    select m.created_at, m.creado_por
      from public.movimientos m
     where m.cuenta_id = s.cuenta_id
     order by m.created_at desc, m.id desc
     limit 1
  ) um on true
  left join lateral (
    select c.fecha_corte, c.diferencia_cents
      from public.conciliaciones c
     where c.cuenta_id = s.cuenta_id
     order by c.fecha_corte desc, c.created_at desc, c.id desc
     limit 1
  ) uc on true
 where coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
   and public.tiene_alcance(s.empresa_id, null);
alter view public.v_saldos owner to postgres;
grant select on public.v_saldos to authenticated;
