-- Situación financiera calculada (nunca se carga a mano): finanzas por trámite, saldos por
-- cuenta Habitualista y política de fondos (R22, regla 17).
-- Las vistas son del dueño (postgres) con security_invoker = false: leen todas las filas para
-- calcular la prioridad de fondos de la cuenta entera, y filtran internamente lo que el usuario
-- puede ver. Grants y RLS de las tablas se definen en 20261027000700_rls.sql.

-- =====================================================================================
-- 1. Visibilidad de trámites
-- =====================================================================================

-- true si el usuario actual puede ver el trámite: gerencia o contable con alcance sobre su
-- empresa y sucursal; la gestora, solo los asignados a ella y ya autorizados.
-- La política RLS de trámites (20261027000700_rls.sql) reutiliza esta función.
create function public.puede_ver_tramite(p_tramite uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case public.mi_rol()
             when 'gerencia' then public.tiene_alcance(t.empresa_id, t.sucursal_id)
             when 'contable' then public.tiene_alcance(t.empresa_id, t.sucursal_id)
             when 'gestora' then t.gestora_id = auth.uid()
                                 and t.estado not in ('borrador', 'observado', 'rechazado')
             else false
           end
      from public.tramites t
     where t.id = p_tramite), false)
$$;

-- =====================================================================================
-- 2. Excepciones de fondos
-- =====================================================================================

-- Gerencia libera un trámite "sin fondos" (regla 17). Una por trámite.
create table public.excepciones_fondos (
  tramite_id uuid primary key references public.tramites (id),
  aprobado_por uuid not null references public.perfiles (id),
  motivo text not null check (btrim(motivo) <> ''),
  at timestamptz not null default now()
);

create trigger trg_auditar after insert or update or delete on public.excepciones_fondos
  for each row execute function public.auditar('tramite_id');

create function public.aprobar_excepcion_fondos(p_tramite uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  if coalesce(public.mi_rol() = 'gerencia', false) is false
     or not public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id) then
    raise exception 'SIN_PERMISO: solo gerencia con alcance aprueba excepciones de fondos';
  end if;

  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo de la excepción es obligatorio';
  end if;

  perform set_config('app.motivo', v_motivo, true);

  insert into public.excepciones_fondos (tramite_id, aprobado_por, motivo)
  values (p_tramite, auth.uid(), v_motivo)
  on conflict (tramite_id) do nothing;
  if not found then
    raise exception 'DUPLICADO: el trámite ya tiene una excepción de fondos';
  end if;
end;
$$;

-- =====================================================================================
-- 3. Cálculo interno (sin filtro de usuario)
-- =====================================================================================
-- Vistas base sin grants: solo las leen las vistas públicas de la sección 4.

create view public.v_saldo_registrado_base as
select c.id as cuenta_id,
       c.empresa_id,
       c.saldo_inicial_cents + coalesce(sum(m.importe_cents), 0)::bigint as registrado_cents
  from public.cuentas c
  left join public.movimientos m on m.cuenta_id = c.id
 group by c.id;

create view public.v_tramite_finanzas_base as
with montos as (
  select t.id as tramite_id,
         t.empresa_id,
         t.estado,
         t.orden_compromiso,
         t.pago_final_at,
         (select p.total_cents from public.presupuestos p
           where p.tramite_id = t.id order by p.version desc limit 1) as presupuesto_cents,
         coalesce((select -sum(m.importe_cents) from public.movimientos m
                    where m.tramite_id = t.id), 0)::bigint as pagado_cents
    from public.tramites t
),
compromisos as (
  select mo.*,
         case when mo.estado in ('autorizado', 'en_gestoria', 'presentado', 'finalizado_registro')
               and mo.pago_final_at is null and mo.presupuesto_cents is not null
              then greatest(mo.presupuesto_cents - mo.pagado_cents, 0)
              else 0
         end::bigint as comprometido_cents
    from montos mo
),
acumulados as (
  select co.*,
         c.id as cuenta_id,
         sum(co.comprometido_cents) over (
           partition by c.id order by co.orden_compromiso, co.tramite_id
           rows between unbounded preceding and current row
         ) as comprometido_acumulado_cents
    from compromisos co
    join public.cuentas c on c.empresa_id = co.empresa_id
)
select a.tramite_id,
       a.empresa_id,
       a.cuenta_id,
       a.presupuesto_cents,
       a.pagado_cents,
       a.comprometido_cents,
       case when a.pago_final_at is not null then a.pagado_cents - a.presupuesto_cents end as desvio_cents,
       case when a.pago_final_at is not null and a.presupuesto_cents > 0
            then round((a.pagado_cents - a.presupuesto_cents)::numeric * 100 / a.presupuesto_cents, 2)
       end::numeric(24, 2) as desvio_pct, -- numeric(7,2) desbordaba con desvíos >= 100000%; 24 dígitos cubre todo el rango bigint
       case
         when a.pago_final_at is not null then 'pagado'
         when a.comprometido_cents > 0
              and not exists (select 1 from public.excepciones_fondos x where x.tramite_id = a.tramite_id)
              and a.comprometido_acumulado_cents > s.registrado_cents then 'sin_fondos'
         when a.comprometido_cents > 0 and a.pagado_cents <= 0 then 'comprometido'
         when a.estado in ('autorizado', 'en_gestoria', 'presentado', 'finalizado_registro')
              and a.presupuesto_cents is null then 'sin_presupuesto'
         when a.estado in ('autorizado', 'en_gestoria', 'presentado', 'finalizado_registro')
              and a.pagado_cents > 0 then 'pagado_parcial'
         else 'no_aplica'
       end as situacion
  from acumulados a
  join public.v_saldo_registrado_base s on s.cuenta_id = a.cuenta_id;

-- Supabase otorga por defecto privilegios a anon y authenticated sobre objetos nuevos.
revoke all on public.v_saldo_registrado_base, public.v_tramite_finanzas_base from public, anon, authenticated;

-- =====================================================================================
-- 4. Vistas públicas (filtradas por usuario)
-- =====================================================================================

-- Finanzas de los trámites que el usuario puede ver.
create view public.v_tramite_finanzas with (security_invoker = false) as
select f.tramite_id,
       f.empresa_id,
       f.presupuesto_cents,
       f.pagado_cents,
       f.comprometido_cents,
       f.desvio_cents,
       f.desvio_pct,
       f.situacion
  from public.v_tramite_finanzas_base f
 where public.puede_ver_tramite(f.tramite_id);

-- Saldos de las cuentas: solo gerencia y contable con alcance sobre toda la razón social.
-- disponible = registrado - comprometido. Las columnas de conciliación llegan en la Tarea 11.
create view public.v_saldos with (security_invoker = false) as
select s.cuenta_id,
       s.empresa_id,
       e.nombre as empresa,
       s.registrado_cents,
       coalesce(comp.comprometido_cents, 0)::bigint as comprometido_cents,
       (s.registrado_cents - coalesce(comp.comprometido_cents, 0))::bigint as disponible_cents,
       um.created_at as ultimo_movimiento_at,
       um.creado_por as ultimo_movimiento_por,
       null::date as ultima_conciliacion_fecha,
       null::bigint as ultima_diferencia_cents
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
 where coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
   and public.tiene_alcance(s.empresa_id, null);

alter view public.v_tramite_finanzas owner to postgres;
alter view public.v_saldos owner to postgres;

revoke all on public.v_tramite_finanzas, public.v_saldos from public, anon, authenticated;
grant select on public.v_tramite_finanzas, public.v_saldos to authenticated;
