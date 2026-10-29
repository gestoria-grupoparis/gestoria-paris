-- Rendiciones: modulo interno (pedido del dueno). Solo gerencia y contable con alcance sobre
-- toda la razon social ven, cargan, controlan y aprueban. La gestora es solo un dato de
-- referencia: no ve las tablas, no ejecuta las RPC y no accede al bucket.
-- Estados: borrador/observada -> enviada (a control) -> observada | aprobada; aprobada -> borrador
-- (reabrir, con motivo).

create or replace function public.puede_ver_rendicion(p_rendicion uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
           and public.tiene_alcance(r.empresa_id, null)
      from public.rendiciones r
     where r.id = p_rendicion), false)
$$;

create or replace function public.crear_rendicion(p_empresa uuid, p_periodo date, p_honorario bigint, p_gestora uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia o contable crean rendiciones';
  end if;
  if not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: sin alcance sobre esa razón social';
  end if;
  if p_gestora is null or not public.es_gestora_activa(p_gestora) then
    raise exception 'DATO_INVALIDO: elegí una gestora activa';
  end if;
  if p_periodo is null then
    raise exception 'DATO_INVALIDO: el mes de la rendición es obligatorio';
  end if;
  if p_honorario is not null and p_honorario <= 0 then
    raise exception 'DATO_INVALIDO: el honorario debe ser mayor a cero';
  end if;

  perform set_config('app.motivo', '', true);
  begin
    insert into public.rendiciones (empresa_id, gestora_id, periodo, honorario_unitario_cents, creado_por)
    values (p_empresa, p_gestora, date_trunc('month', p_periodo)::date, coalesce(p_honorario, 3250000), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICADO: ya existe la rendición de ese mes para esa gestora y razón social';
  end;
  return v_id;
end;
$$;

create or replace function public.cambiar_estado_rendicion(p_rendicion uuid, p_estado text, p_motivo text, p_version int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia o contable cambian el estado de una rendición';
  end if;
  select r.* into v_r from public.rendiciones r where r.id = p_rendicion for update;
  if not found or not public.puede_ver_rendicion(p_rendicion) then
    raise exception 'NO_ENCONTRADO: rendición inexistente';
  end if;
  if p_estado not in ('borrador', 'enviada', 'observada', 'aprobada') then
    raise exception 'DATO_INVALIDO: estado de rendición desconocido';
  end if;
  if v_r.version is distinct from p_version then
    raise exception 'VERSION_CONFLICTO: otro usuario modificó esta rendición; recargá';
  end if;
  if not ((v_r.estado, p_estado) in (
      ('borrador', 'enviada'), ('observada', 'enviada'),
      ('enviada', 'observada'), ('enviada', 'aprobada'),
      ('aprobada', 'borrador'))) then
    raise exception 'TRANSICION_INVALIDA: no se puede pasar de % a %', v_r.estado, p_estado;
  end if;
  if p_estado in ('observada', 'borrador') and nullif(btrim(p_motivo), '') is null then
    raise exception 'DATO_INVALIDO: % exige un motivo', case when p_estado = 'observada' then 'observar' else 'reabrir' end;
  end if;

  perform set_config('app.motivo', coalesce(nullif(btrim(p_motivo), ''), ''), true);
  update public.rendiciones
     set estado = p_estado,
         motivo_observacion = case when p_estado = 'observada' then btrim(p_motivo) else motivo_observacion end,
         version = version + 1
   where id = p_rendicion;
end;
$$;
