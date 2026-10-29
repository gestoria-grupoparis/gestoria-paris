-- Analisis del gasto real y prevision semanal de fondos (modulo interno: gerencia y contable con
-- alcance sobre la razon social). Solo lectura: no crea movimientos ni toca saldos.
-- Gasto real = pagos netos imputados a tramites (-importe de movimientos con tramite), por fecha de
-- operacion, igual que informe_costos_tramites. Montos en centavos como texto dentro del jsonb.

create function public.analisis_gastos(p_desde date, p_hasta date, p_empresa uuid, p_sucursal uuid, p_tipo text)
returns jsonb
language plpgsql stable security definer
set search_path = public
set timezone = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_dias int;
  v_ant_desde date;
  v_semanal boolean;
  v_res jsonb;
begin
  if not public.es_interno() then
    raise exception 'SIN_PERMISO: solo gerencia o contable ven el analisis';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'DATO_INVALIDO: el periodo no es valido';
  end if;
  if p_hasta - p_desde > 731 then
    raise exception 'DATO_INVALIDO: el periodo no puede superar dos anios';
  end if;
  if p_empresa is not null and not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: sin alcance sobre esa razon social';
  end if;
  v_dias := p_hasta - p_desde + 1;
  v_ant_desde := p_desde - v_dias;
  v_semanal := v_dias > 31;

  with tr as (
    select t.id, t.empresa_id, t.estado, t.created_at, tt.codigo as tipo, tt.nombre as tipo_nombre, e.nombre as empresa
      from public.tramites t
      join public.tipos_tramite tt on tt.id = t.tipo_id
      join public.empresas e on e.id = t.empresa_id
     where public.tiene_alcance(t.empresa_id, null)
       and (p_empresa is null or t.empresa_id = p_empresa)
       and (p_sucursal is null or t.sucursal_id = p_sucursal)
       and (p_tipo is null or tt.codigo = p_tipo)
  ),
  mov as (
    select m.*, tr.tipo, tr.tipo_nombre, tr.empresa, (-m.importe_cents)::bigint as gasto
      from public.movimientos m
      join tr on tr.id = m.tramite_id
     where m.fecha_operacion between v_ant_desde and p_hasta
  ),
  act as (select * from mov where fecha_operacion >= p_desde),
  hon as (
    select coalesce(sum(f.honorarios_cents), 0)::bigint as cents
      from public.rendicion_filas f
      join public.rendiciones r on r.id = f.rendicion_id
     where public.tiene_alcance(r.empresa_id, null)
       and (p_empresa is null or r.empresa_id = p_empresa)
       and r.periodo between date_trunc('month', p_desde)::date and p_hasta
       and (p_sucursal is null and p_tipo is null or f.tramite_id in (select id from tr))
  ),
  pend as (
    select coalesce(sum(es.total_cents), 0)::bigint as cents
      from tr
      join lateral (select e.total_cents from public.estimados e where e.tramite_id = tr.id order by e.version desc limit 1) es on true
     where tr.estado in ('borrador', 'observado', 'autorizado', 'en_gestoria', 'presentado', 'finalizado_registro')
       and not exists (select 1 from public.presupuestos p where p.tramite_id = tr.id)
  ),
  totales as (
    select coalesce(sum(gasto) filter (where fecha_operacion >= p_desde), 0)::bigint as actual,
           coalesce(sum(gasto) filter (where fecha_operacion < p_desde), 0)::bigint as anterior
      from mov
  ),
  serie as (
    select g::date as fecha,
           coalesce((select sum(a.gasto) from act a
                      where a.fecha_operacion >= g::date
                        and a.fecha_operacion < (g + case when v_semanal then interval '7 days' else interval '1 day' end)::date), 0)::bigint as cents
      from generate_series(case when v_semanal then date_trunc('week', p_desde) else p_desde end, p_hasta,
                           case when v_semanal then interval '7 days' else interval '1 day' end) g
  ),
  semanas as (
    select g::date as semana,
           (select count(*) from tr
             where (tr.created_at at time zone 'America/Argentina/Buenos_Aires')::date >= greatest(g::date, p_desde)
               and (tr.created_at at time zone 'America/Argentina/Buenos_Aires')::date < least((g + interval '7 days')::date, p_hasta + 1))::int as tramites
      from generate_series(date_trunc('week', p_desde), p_hasta, interval '7 days') g
  ),
  conceptos as (
    select 'arancel' as etiqueta, coalesce(sum(arancel_cents), 0)::bigint as cents from act
    union all select 'prenda', coalesce(sum(prenda_cents), 0)::bigint from act
    union all select 'sellos', coalesce(sum(sellado_cents), 0)::bigint from act
    union all select 'honorarios', (select cents from hon)
    union all select 'otros', coalesce(sum(coalesce(otros_cents, case when arancel_cents is null then gasto else 0 end)), 0)::bigint from act
  )
  select jsonb_build_object(
    'granularidad', case when v_semanal then 'semana' else 'dia' end,
    'kpis', jsonb_build_object(
      'gasto_cents', t.actual::text,
      'gasto_anterior_cents', t.anterior::text,
      'variacion_pct', case when t.anterior > 0 then round((t.actual - t.anterior)::numeric * 100 / t.anterior, 1) end,
      'estimado_pendiente_cents', (select cents from pend)::text,
      'honorarios_cents', (select cents from hon)::text,
      'tramites', jsonb_build_object(
        'patentamiento_0km', (select count(*) from tr where tipo = 'patentamiento_0km'
                               and (created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta),
        'transferencia_usado', (select count(*) from tr where tipo = 'transferencia_usado'
                               and (created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta),
        'transferencia_parte_pago', (select count(*) from tr where tipo = 'transferencia_parte_pago'
                               and (created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta))),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('fecha', fecha, 'gasto_cents', cents::text) order by fecha), '[]') from serie),
    'semanas', (select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'tramites', tramites) order by semana), '[]') from semanas),
    'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', x.k, 'cents', x.c::text) order by x.c desc), '[]')
                   from (select tipo_nombre k, sum(gasto)::bigint c from act group by 1 having sum(gasto) <> 0) x),
    'por_empresa', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', x.k, 'cents', x.c::text) order by x.c desc), '[]')
                      from (select empresa k, sum(gasto)::bigint c from act group by 1 having sum(gasto) <> 0) x),
    'por_concepto', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', etiqueta, 'cents', cents::text)), '[]') from conceptos where cents <> 0)
  ) into v_res
  from totales t;
  return v_res;
end;
$$;

-- Prevision semanal: pipeline confirmado (tramites en curso sin pago final, con presupuesto o
-- estimado) y proyeccion por historial (promedio de las ultimas 4 semanas cerradas y misma semana
-- del mes de los ultimos 3 meses). previsto = greatest(pipeline, base): la proyeccion ya incluye lo
-- que esta en el pipeline, asi que no se suman. Con menos de 4 semanas de historia no se proyecta.
create function public.prevision_fondos(p_hoy date, p_empresa uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
set timezone = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_sem0 date;
  v_hist int;
  v_suf boolean;
  v_res jsonb;
begin
  if not public.es_interno() then
    raise exception 'SIN_PERMISO: solo gerencia o contable ven la prevision';
  end if;
  if p_empresa is not null and not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: sin alcance sobre esa razon social';
  end if;
  v_sem0 := date_trunc('week', coalesce(p_hoy, current_date))::date;

  select coalesce(least(13, (v_sem0 - date_trunc('week', min(m.fecha_operacion))::date) / 7), 0)
    into v_hist
    from public.movimientos m
    join public.tramites t on t.id = m.tramite_id
   where m.fecha_operacion < v_sem0
     and public.tiene_alcance(t.empresa_id, null)
     and (p_empresa is null or t.empresa_id = p_empresa);
  v_suf := v_hist >= 4;

  with emp as (
    select e.id, e.nombre, c.id as cuenta_id
      from public.empresas e
      join public.cuentas c on c.empresa_id = e.id
     where public.tiene_alcance(e.id, null) and (p_empresa is null or e.id = p_empresa)
  ),
  hist as (
    select emp.id as empresa_id, g::date as sem,
           ((extract(day from g)::int - 1) / 7 + 1) as nro,
           coalesce((select -sum(m.importe_cents) from public.movimientos m
                       join public.tramites t on t.id = m.tramite_id
                      where t.empresa_id = emp.id and m.fecha_operacion >= g::date
                        and m.fecha_operacion < (g + interval '7 days')::date), 0)::bigint as cents
      from emp, generate_series(v_sem0 - 91, v_sem0 - 7, interval '7 days') g
  ),
  fut as (
    select emp.id as empresa_id, i, (v_sem0 + 7 * i) as sem, ((extract(day from v_sem0 + 7 * i)::int - 1) / 7 + 1) as nro
      from emp, generate_series(0, 3) i
  ),
  pipe as (
    select t.empresa_id,
           case when f.presupuesto_cents is not null then v_sem0 else v_sem0 + 7 end as sem,
           greatest(coalesce(f.presupuesto_cents, es.total_cents) - f.pagado_cents, 0)::bigint as cents,
           (f.presupuesto_cents is null and es.total_cents is null) as sin_monto
      from public.tramites t
      join emp on emp.id = t.empresa_id
      join public.v_tramite_finanzas_base f on f.tramite_id = t.id
      left join lateral (select e.total_cents from public.estimados e where e.tramite_id = t.id order by e.version desc limit 1) es on true
     where t.estado in ('autorizado', 'en_gestoria', 'presentado', 'finalizado_registro')
       and t.pago_final_at is null
  ),
  calc as (
    select fu.empresa_id, fu.i, fu.sem,
           coalesce((select sum(p.cents) from pipe p where p.empresa_id = fu.empresa_id and p.sem = fu.sem and not p.sin_monto), 0)::bigint as pipeline,
           case when v_suf then (select round(avg(h.cents))::bigint from hist h
                                  where h.empresa_id = fu.empresa_id and h.sem >= v_sem0 - 28) end as base,
           case when v_suf then (select round(avg(h.cents))::bigint from hist h
                                  where h.empresa_id = fu.empresa_id and h.nro = fu.nro) end as misma,
           case when v_suf then (select max(h.cents) from hist h
                                  where h.empresa_id = fu.empresa_id and (h.nro = fu.nro or h.sem >= v_sem0 - 28)) end as alto
      from fut fu
  ),
  calc2 as (
    select c.*, greatest(c.pipeline, coalesce(c.base, 0))::bigint as previsto from calc c
  ),
  saldos as (
    select emp.id, emp.nombre, s.registrado_cents,
           (s.registrado_cents - coalesce((select sum(f.comprometido_cents) from public.v_tramite_finanzas_base f
                                            where f.cuenta_id = emp.cuenta_id), 0))::bigint as disponible,
           (select sum(previsto) from calc2 c where c.empresa_id = emp.id and c.i < 1)::bigint as p1,
           (select sum(previsto) from calc2 c where c.empresa_id = emp.id and c.i < 2)::bigint as p2,
           (select sum(previsto) from calc2 c where c.empresa_id = emp.id and c.i < 4)::bigint as p4
      from emp
      join public.v_saldo_registrado_base s on s.cuenta_id = emp.cuenta_id
  )
  select jsonb_build_object(
    'semanas_historia', v_hist,
    'suficiente', v_suf,
    'sin_monto', (select count(*) from pipe where sin_monto),
    'semanas', (select coalesce(jsonb_agg(x order by x.semana), '[]') from (
        select c.sem as semana,
               sum(c.pipeline)::bigint::text as pipeline_cents,
               case when v_suf then sum(c.base)::bigint::text end as base_cents,
               case when v_suf then sum(c.misma)::bigint::text end as misma_semana_cents,
               case when v_suf then sum(c.alto)::bigint::text end as alto_cents,
               sum(c.previsto)::bigint::text as previsto_cents
          from calc2 c group by c.sem) x),
    'saldos', (select coalesce(jsonb_agg(jsonb_build_object(
        'empresa_id', s.id, 'empresa', s.nombre,
        'registrado_cents', s.registrado_cents::text, 'disponible_cents', s.disponible::text,
        'previsto_1_cents', s.p1::text, 'previsto_2_cents', s.p2::text, 'previsto_4_cents', s.p4::text,
        'alerta', s.registrado_cents < s.p4) order by s.nombre), '[]') from saldos s)
  ) into v_res;
  return v_res;
end;
$$;

revoke all on function public.analisis_gastos(date, date, uuid, uuid, text), public.prevision_fondos(date, uuid)
  from public, anon, authenticated;
grant execute on function public.analisis_gastos(date, date, uuid, uuid, text), public.prevision_fondos(date, uuid)
  to authenticated;
