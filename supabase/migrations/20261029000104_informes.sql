-- Informes de Etapa 2: cierre mensual de la Habitualista por razón social y costo por trámite
-- contra presupuesto. Todo se calcula en la base desde el ledger inmutable (regla 15).
-- Reglas de fecha (spec J): los movimientos y los costos se imputan por fecha_operacion, que ya
-- es una fecha operativa en hora de Argentina. El mes se recibe como cualquier día del mes.
-- Alcance: gerencia o contable, solo razones sociales sobre las que tienen alcance completo
-- (igual que v_saldos y v_movimientos_extracto).

create function public.informe_cierre_mensual(p_mes date, p_empresa uuid default null)
returns table (
  mes date,
  empresa_id uuid,
  empresa text,
  cuenta_id uuid,
  saldo_inicial_cents bigint,
  cargas_cents bigint,
  pagos_cents bigint,
  ajustes_cents bigint,
  reintegros_cents bigint,
  reversiones_cents bigint,
  saldo_final_cents bigint,
  movimientos int
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_desde date;
  v_hasta date;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia o contable consultan informes';
  end if;
  if p_mes is null then
    raise exception 'DATO_INVALIDO: el mes del informe es obligatorio';
  end if;
  if p_empresa is not null and not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: sin alcance sobre esa razón social';
  end if;

  v_desde := date_trunc('month', p_mes)::date;
  v_hasta := (v_desde + interval '1 month')::date;

  return query
  select v_desde,
         e.id,
         e.nombre,
         c.id,
         (c.saldo_inicial_cents + coalesce(sum(m.importe_cents) filter (where m.fecha_operacion < v_desde), 0))::bigint,
         coalesce(sum(m.importe_cents) filter (where m.tipo = 'carga' and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta), 0)::bigint,
         coalesce(-sum(m.importe_cents) filter (where m.tipo = 'pago_tramite' and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta), 0)::bigint,
         coalesce(sum(m.importe_cents) filter (where m.tipo = 'ajuste' and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta), 0)::bigint,
         coalesce(sum(m.importe_cents) filter (where m.tipo = 'reintegro' and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta), 0)::bigint,
         coalesce(sum(m.importe_cents) filter (where m.tipo = 'reversion' and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta), 0)::bigint,
         (c.saldo_inicial_cents + coalesce(sum(m.importe_cents) filter (where m.fecha_operacion < v_hasta), 0))::bigint,
         (count(m.id) filter (where m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta))::int
    from public.cuentas c
    join public.empresas e on e.id = c.empresa_id
    left join public.movimientos m on m.cuenta_id = c.id and m.fecha_operacion < v_hasta
   where public.tiene_alcance(c.empresa_id, null)
     and (p_empresa is null or c.empresa_id = p_empresa)
   group by e.id, e.nombre, c.id, c.saldo_inicial_cents
   order by e.nombre;
end;
$$;

-- Costo por trámite: trámites con movimientos imputados al mes (pagos, reintegros o reversiones
-- con trámite). costo_mes = lo pagado neto en el mes; el desvío es sobre el total pagado contra la
-- última versión del presupuesto, y solo existe con pago final (igual que v_tramite_finanzas).
create function public.informe_costos_tramites(p_mes date, p_empresa uuid default null)
returns table (
  mes date,
  tramite_id uuid,
  numero text,
  empresa_id uuid,
  empresa text,
  sucursal text,
  tipo text,
  cliente text,
  gestora text,
  estado text,
  presupuesto_cents bigint,
  costo_mes_cents bigint,
  pagado_total_cents bigint,
  pago_final boolean,
  desvio_cents bigint,
  desvio_pct numeric
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_desde date;
  v_hasta date;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia o contable consultan informes';
  end if;
  if p_mes is null then
    raise exception 'DATO_INVALIDO: el mes del informe es obligatorio';
  end if;
  if p_empresa is not null and not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: sin alcance sobre esa razón social';
  end if;

  v_desde := date_trunc('month', p_mes)::date;
  v_hasta := (v_desde + interval '1 month')::date;

  return query
  with del_mes as (
    select m.tramite_id, (-sum(m.importe_cents))::bigint as costo
      from public.movimientos m
     where m.tramite_id is not null
       and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta
     group by m.tramite_id
  )
  select v_desde,
         t.id,
         t.numero,
         t.empresa_id,
         e.nombre,
         s.nombre,
         tt.nombre,
         o.cliente_nombre,
         g.nombre,
         t.estado,
         f.presupuesto_cents,
         d.costo,
         f.pagado_cents,
         t.pago_final_at is not null,
         f.desvio_cents,
         f.desvio_pct
    from del_mes d
    join public.tramites t on t.id = d.tramite_id
    join public.empresas e on e.id = t.empresa_id
    join public.sucursales s on s.id = t.sucursal_id
    join public.tipos_tramite tt on tt.id = t.tipo_id
    join public.operaciones o on o.id = t.operacion_id
    join public.v_tramite_finanzas_base f on f.tramite_id = t.id
    left join public.perfiles g on g.id = t.gestora_id
   where public.tiene_alcance(t.empresa_id, t.sucursal_id)
     and (p_empresa is null or t.empresa_id = p_empresa)
   order by e.nombre, t.numero;
end;
$$;

revoke all on function public.informe_cierre_mensual(date, uuid), public.informe_costos_tramites(date, uuid)
  from public, anon;
grant execute on function public.informe_cierre_mensual(date, uuid), public.informe_costos_tramites(date, uuid)
  to authenticated;
