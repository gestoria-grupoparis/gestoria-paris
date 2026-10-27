-- Conciliación simple (spec D paso 7, casos H/I): contable o gerencia carga el saldo que muestra
-- la Habitualista a una fecha de corte; se guarda la foto del saldo interno y la diferencia, y se
-- marcan los movimientos verificados. Además, el extracto con saldo resultante (Tarea 16) y las
-- columnas de conciliación de v_saldos. Conciliaciones y marcas son solo INSERT.

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

create table public.conciliaciones (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas (id),
  fecha_corte date not null,
  saldo_externo_cents bigint not null,
  saldo_interno_cents bigint not null,
  diferencia_cents bigint not null,
  nota text,
  creado_por uuid not null references public.perfiles (id),
  created_at timestamptz not null default now(),
  constraint conciliaciones_diferencia_check
    check (diferencia_cents = saldo_externo_cents - saldo_interno_cents)
);

create index conciliaciones_cuenta_idx on public.conciliaciones (cuenta_id, fecha_corte);

create table public.movimientos_conciliados (
  movimiento_id uuid primary key references public.movimientos (id),
  conciliacion_id uuid not null references public.conciliaciones (id)
);

create index movimientos_conciliados_conciliacion_idx on public.movimientos_conciliados (conciliacion_id);

create trigger trg_auditar after insert or update or delete on public.conciliaciones
  for each row execute function public.auditar();
create trigger trg_inmutable before update or delete on public.conciliaciones
  for each row execute function public.impedir_modificacion();
create trigger trg_inmutable_truncate before truncate on public.conciliaciones
  for each statement execute function public.impedir_modificacion();

create trigger trg_auditar after insert or update or delete on public.movimientos_conciliados
  for each row execute function public.auditar('movimiento_id');
create trigger trg_inmutable before update or delete on public.movimientos_conciliados
  for each row execute function public.impedir_modificacion();
create trigger trg_inmutable_truncate before truncate on public.movimientos_conciliados
  for each statement execute function public.impedir_modificacion();

-- =====================================================================================
-- 2. RPC
-- =====================================================================================

-- saldo_interno = saldo inicial + suma de movimientos con fecha_operacion <= p_fecha_corte.
-- diferencia = externo - interno: positiva cuando falta registrar una carga (caso H).
-- Los movimientos indicados deben ser de la cuenta de la empresa; los ya conciliados
-- conservan su conciliación original.
create function public.registrar_conciliacion(
  p_empresa uuid,
  p_fecha_corte date,
  p_saldo_externo bigint,
  p_nota text,
  p_movimientos uuid[]
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cuenta uuid;
  v_interno bigint;
  v_id uuid;
  v_otro uuid;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance concilian';
  end if;
  if p_fecha_corte is null or p_saldo_externo is null then
    raise exception 'DATO_INVALIDO: la fecha de corte y el saldo externo son obligatorios';
  end if;

  v_cuenta := public.bloquear_cuenta_empresa(p_empresa);

  select x.id into v_otro
    from unnest(coalesce(p_movimientos, '{}'::uuid[])) as x(id)
   where not exists (select 1 from public.movimientos m where m.id = x.id)
   limit 1;
  if v_otro is not null then
    raise exception 'NO_ENCONTRADO: movimiento %', v_otro;
  end if;

  select m.id into v_otro
    from public.movimientos m
   where m.id = any (coalesce(p_movimientos, '{}'::uuid[])) and m.cuenta_id <> v_cuenta
   limit 1;
  if v_otro is not null then
    raise exception 'EMPRESA_DISTINTA: el movimiento % es de otra cuenta', v_otro;
  end if;

  select c.saldo_inicial_cents + coalesce(
           (select sum(m.importe_cents) from public.movimientos m
             where m.cuenta_id = c.id and m.fecha_operacion <= p_fecha_corte), 0)::bigint
    into v_interno
    from public.cuentas c
   where c.id = v_cuenta;

  perform set_config('app.motivo', coalesce(btrim(p_nota), ''), true);

  insert into public.conciliaciones (
    cuenta_id, fecha_corte, saldo_externo_cents, saldo_interno_cents, diferencia_cents, nota, creado_por)
  values (
    v_cuenta, p_fecha_corte, p_saldo_externo, v_interno, p_saldo_externo - v_interno,
    nullif(btrim(p_nota), ''), auth.uid())
  returning id into v_id;

  insert into public.movimientos_conciliados (movimiento_id, conciliacion_id)
  select distinct x.id, v_id
    from unnest(coalesce(p_movimientos, '{}'::uuid[])) as x(id)
  on conflict (movimiento_id) do nothing;

  return v_id;
end;
$$;

-- =====================================================================================
-- 3. Vistas
-- =====================================================================================

-- Mismas columnas, orden y filtro que en 20261027000600_vistas.sql; ahora con la última
-- conciliación (la de fecha de corte más reciente).
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
       uc.diferencia_cents as ultima_diferencia_cents
  from public.v_saldo_registrado_base s
  join public.empresas e on e.id = s.empresa_id
  left join lateral (
    select sum(f.comprometido_cents) as comprometido_cents
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

-- Extracto de la Habitualista: saldo acumulado por fecha_operacion, created_at (id desempata).
-- Mismo filtro que v_saldos. responsable = quien registró el movimiento.
create view public.v_movimientos_extracto with (security_invoker = false) as
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
       (mc.movimiento_id is not null) as conciliado
  from public.movimientos m
  join public.cuentas c on c.id = m.cuenta_id
  join public.perfiles p on p.id = m.creado_por
  left join public.tramites t on t.id = m.tramite_id
  left join public.operaciones o on o.id = t.operacion_id
  left join public.movimientos_conciliados mc on mc.movimiento_id = m.id
 where coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
   and public.tiene_alcance(c.empresa_id, null);

alter view public.v_saldos owner to postgres;
alter view public.v_movimientos_extracto owner to postgres;

-- =====================================================================================
-- 4. Grants y RLS (mismo criterio que 20261027000700_rls.sql)
-- =====================================================================================

revoke all on public.conciliaciones, public.movimientos_conciliados, public.v_movimientos_extracto
  from public, anon, authenticated;
grant select on public.conciliaciones, public.movimientos_conciliados, public.v_movimientos_extracto
  to authenticated;

alter table public.conciliaciones enable row level security;
alter table public.movimientos_conciliados enable row level security;

create policy conciliaciones_select on public.conciliaciones for select to authenticated
  using (public.mi_rol() in ('gerencia', 'contable')
         and exists (select 1 from public.cuentas c
                      where c.id = conciliaciones.cuenta_id
                        and public.tiene_alcance(c.empresa_id, null)));
create policy movimientos_conciliados_select on public.movimientos_conciliados for select to authenticated
  using (public.mi_rol() in ('gerencia', 'contable')
         and exists (select 1 from public.conciliaciones k
                       join public.cuentas c on c.id = k.cuenta_id
                      where k.id = movimientos_conciliados.conciliacion_id
                        and public.tiene_alcance(c.empresa_id, null)));

revoke execute on function public.registrar_conciliacion(uuid, date, bigint, text, uuid[]) from public, anon, authenticated;
grant execute on function public.registrar_conciliacion(uuid, date, bigint, text, uuid[]) to authenticated;
