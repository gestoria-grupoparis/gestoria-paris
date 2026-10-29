-- Exportar el extracto completo: la vista expone created_at para que el cliente pueda ordenar
-- (fecha_operacion, created_at, movimiento_id) exactamente como el saldo acumulado.
-- La columna nueva va al final: create or replace view no permite reordenar las existentes.
create or replace view public.v_movimientos_extracto with (security_invoker = false) as
select m.id as movimiento_id,
       m.cuenta_id,
       m.fecha_operacion,
       m.tipo,
       t.numero as tramite_numero,
       o.cliente_nombre as cliente,
       p.nombre as responsable,
       greatest(m.importe_cents, 0)::bigint as ingreso_cents,
       greatest(-m.importe_cents, 0)::bigint as egreso_cents,
       (c.saldo_inicial_cents + sum(m.importe_cents) over (
          partition by m.cuenta_id
          order by m.fecha_operacion, m.created_at, m.id
          rows between unbounded preceding and current row))::bigint as saldo_resultante_cents,
       (mc.movimiento_id is not null) as conciliado,
       m.created_at
  from public.movimientos m
  join public.cuentas c on c.id = m.cuenta_id
  join public.perfiles p on p.id = m.creado_por
  left join public.tramites t on t.id = m.tramite_id
  left join public.operaciones o on o.id = t.operacion_id
  left join public.movimientos_conciliados mc on mc.movimiento_id = m.id
 where coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
   and public.tiene_alcance(c.empresa_id, null);

alter view public.v_movimientos_extracto owner to postgres;
revoke all on public.v_movimientos_extracto from public, anon, authenticated;
grant select on public.v_movimientos_extracto to authenticated;
