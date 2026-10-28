-- Revisión final:
-- 1. registrar_conciliacion idempotente por p_idem (mismo patrón que las RPC de dinero:
--    búsqueda -> bloqueo de la cuenta FOR UPDATE -> nueva búsqueda -> on conflict).
-- 2. eventos_select: la gestora solo ve eventos de trámites, marcas, presupuestos y sus propios
--    pagos (mismo alcance que sus políticas de tabla); nunca excepciones_fondos.
-- 3. Una clave de idempotencia ajena no devuelve el id de otro usuario: da DUPLICADO.

-- =====================================================================================
-- 3. Idempotencia de dinero restringida a quien creó el movimiento
-- =====================================================================================

create or replace function public.movimiento_por_idem(p_idem uuid) returns uuid
language plpgsql stable
set search_path = public
as $$
declare
  v_id uuid;
  v_por uuid;
begin
  if p_idem is null then
    raise exception 'DATO_INVALIDO: falta la clave de idempotencia';
  end if;
  select m.id, m.creado_por into v_id, v_por from public.movimientos m where m.idem_key = p_idem;
  if v_id is not null and v_por is distinct from auth.uid() then
    raise exception 'DUPLICADO: la clave de idempotencia ya fue usada por otro usuario';
  end if;
  return v_id;
end;
$$;

create or replace function public.insertar_movimiento(
  p_idem uuid,
  p_cuenta uuid,
  p_tipo text,
  p_importe bigint,
  p_fecha date,
  p_tramite uuid,
  p_revierte uuid,
  p_arancel bigint,
  p_prenda bigint,
  p_sellado bigint,
  p_otros bigint,
  p_es_final boolean,
  p_motivo text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);

  insert into public.movimientos (
    cuenta_id, tipo, importe_cents, fecha_operacion, tramite_id, revierte_id,
    arancel_cents, prenda_cents, sellado_cents, otros_cents, es_pago_final, motivo, creado_por, idem_key
  ) values (
    p_cuenta, p_tipo, p_importe, p_fecha, p_tramite, p_revierte,
    p_arancel, p_prenda, p_sellado, p_otros, p_es_final, p_motivo, auth.uid(), p_idem
  )
  on conflict (idem_key) do nothing
  returning id into v_id;

  if v_id is null then
    v_id := public.movimiento_por_idem(p_idem);
  end if;
  return v_id;
end;
$$;

revoke execute on function public.movimiento_por_idem(uuid) from public;
revoke execute on function public.insertar_movimiento(uuid, uuid, text, bigint, date, uuid, uuid, bigint, bigint, bigint, bigint, boolean, text) from public;

-- =====================================================================================
-- 1. Conciliación idempotente
-- =====================================================================================

-- Las conciliaciones existentes reciben una clave propia; las nuevas la traen del cliente.
alter table public.conciliaciones disable trigger trg_inmutable;
alter table public.conciliaciones add column idem_key uuid;
update public.conciliaciones set idem_key = gen_random_uuid() where idem_key is null;
alter table public.conciliaciones alter column idem_key set not null;
alter table public.conciliaciones add constraint conciliaciones_idem_key_key unique (idem_key);
alter table public.conciliaciones enable trigger trg_inmutable;

drop function public.registrar_conciliacion(uuid, date, bigint, text, uuid[]);

create function public.conciliacion_por_idem(p_idem uuid) returns uuid
language plpgsql stable
set search_path = public
as $$
declare
  v_id uuid;
  v_por uuid;
begin
  if p_idem is null then
    raise exception 'DATO_INVALIDO: falta la clave de idempotencia';
  end if;
  select k.id, k.creado_por into v_id, v_por from public.conciliaciones k where k.idem_key = p_idem;
  if v_id is not null and v_por is distinct from auth.uid() then
    raise exception 'DUPLICADO: la clave de idempotencia ya fue usada por otro usuario';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.conciliacion_por_idem(uuid) from public;

create function public.registrar_conciliacion(
  p_idem uuid,
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
  v_id uuid := public.conciliacion_por_idem(p_idem);
  v_otro uuid;
begin
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance concilian';
  end if;
  if p_fecha_corte is null or p_saldo_externo is null then
    raise exception 'DATO_INVALIDO: la fecha de corte y el saldo externo son obligatorios';
  end if;

  v_cuenta := public.bloquear_cuenta_empresa(p_empresa);
  v_id := public.conciliacion_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

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
    cuenta_id, fecha_corte, saldo_externo_cents, saldo_interno_cents, diferencia_cents, nota, creado_por, idem_key)
  values (
    v_cuenta, p_fecha_corte, p_saldo_externo, v_interno, p_saldo_externo - v_interno,
    nullif(btrim(p_nota), ''), auth.uid(), p_idem)
  on conflict (idem_key) do nothing
  returning id into v_id;

  if v_id is null then
    return public.conciliacion_por_idem(p_idem);
  end if;

  insert into public.movimientos_conciliados (movimiento_id, conciliacion_id)
  select distinct x.id, v_id
    from unnest(coalesce(p_movimientos, '{}'::uuid[])) as x(id)
  on conflict (movimiento_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.registrar_conciliacion(uuid, uuid, date, bigint, text, uuid[]) from public, anon, authenticated;
grant execute on function public.registrar_conciliacion(uuid, uuid, date, bigint, text, uuid[]) to authenticated;

-- =====================================================================================
-- 2. Historial de la gestora
-- =====================================================================================

drop policy eventos_select on public.eventos;
create policy eventos_select on public.eventos for select to authenticated
  using (
    case
      when public.mi_rol() in ('gerencia', 'contable') then
        case entidad
          when 'perfiles' then true
          when 'alcances' then true
          when 'tramites' then public.puede_ver_tramite(entidad_id)
          when 'tramite_marcas' then public.puede_ver_tramite(entidad_id)
          when 'excepciones_fondos' then public.puede_ver_tramite(entidad_id)
          when 'presupuestos' then public.puede_ver_tramite(
            (coalesce(despues, antes) ->> 'tramite_id')::uuid)
          when 'operaciones' then public.tiene_alcance(
            (coalesce(despues, antes) ->> 'empresa_id')::uuid,
            (coalesce(despues, antes) ->> 'sucursal_id')::uuid)
          when 'cuentas' then public.tiene_alcance(
            (coalesce(despues, antes) ->> 'empresa_id')::uuid, null)
          when 'movimientos' then exists (
            select 1 from public.cuentas c
             where c.id = (coalesce(eventos.despues, eventos.antes) ->> 'cuenta_id')::uuid
               and public.tiene_alcance(c.empresa_id, null))
          else false
        end
      when public.mi_rol() = 'gestora' then
        -- Mismo alcance que tramites/tramite_marcas/presupuestos_select y movimientos_select
        -- (solo sus propios pagos). excepciones_fondos y el resto quedan fuera.
        case entidad
          when 'tramites' then public.puede_ver_tramite(entidad_id)
          when 'tramite_marcas' then public.puede_ver_tramite(entidad_id)
          when 'presupuestos' then public.puede_ver_tramite(
            (coalesce(despues, antes) ->> 'tramite_id')::uuid)
          when 'movimientos' then
            (coalesce(despues, antes) ->> 'creado_por')::uuid = auth.uid()
          else false
        end
      else false
    end
  );
