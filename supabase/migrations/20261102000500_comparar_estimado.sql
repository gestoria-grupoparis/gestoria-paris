-- Comparacion del ultimo estimado de un tramite con su presupuesto real vigente (para calibrar).
-- Modulo interno: solo gerencia y contable con alcance. El front solo formatea.

create function public.comparar_estimado(p_tramite uuid)
returns table (estimado_cents bigint, real_cents bigint, diferencia_cents bigint, diferencia_pct numeric)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  if not public.es_interno() then
    raise exception 'SIN_PERMISO: solo gerencia o contable comparan estimados';
  end if;
  select t.empresa_id into v_emp from public.tramites t where t.id = p_tramite;
  if v_emp is null or not public.tiene_alcance(v_emp, null) then
    raise exception 'NO_ENCONTRADO: tramite inexistente';
  end if;
  return query
  with e as (select x.total_cents from public.estimados x where x.tramite_id = p_tramite order by x.version desc limit 1),
       p as (select x.total_cents from public.presupuestos x where x.tramite_id = p_tramite order by x.version desc limit 1)
  select (select total_cents from e), (select total_cents from p),
         (select total_cents from p) - (select total_cents from e),
         case when (select total_cents from e) > 0
              then round(((select total_cents from p) - (select total_cents from e))::numeric * 100 / (select total_cents from e), 1) end;
end;
$$;

revoke all on function public.comparar_estimado(uuid) from public, anon, authenticated;
grant execute on function public.comparar_estimado(uuid) to authenticated;
