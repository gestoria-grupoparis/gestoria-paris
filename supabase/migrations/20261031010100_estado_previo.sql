-- Reanudar un trámite suspendido sin que el front calcule el estado previo.
-- estado_previo_suspension: el "antes" de la última actualización que suspendió el trámite
-- (misma consulta que usa cambiar_estado). reanudar_tramite: lo resuelve y llama a cambiar_estado.

create function public.estado_previo_suspension(p_tramite uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_previo text;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;
  if not (coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
          and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id))
     and not (public.mi_rol() = 'gestora' and v_t.gestora_id = auth.uid()) then
    raise exception 'SIN_PERMISO: sin alcance sobre este trámite';
  end if;
  select e.antes ->> 'estado' into v_previo
    from public.eventos e
   where e.entidad = 'tramites' and e.entidad_id = p_tramite and e.accion = 'update'
     and e.despues ->> 'estado' = 'suspendido' and e.antes ->> 'estado' <> 'suspendido'
   order by e.id desc
   limit 1;
  return v_previo;
end;
$$;

create function public.reanudar_tramite(p_tramite uuid, p_motivo text, p_version int)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_previo text;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;
  if not (coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
          and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id)) then
    raise exception 'SIN_PERMISO: solo la oficina reanuda trámites suspendidos';
  end if;
  if v_t.estado <> 'suspendido' then
    raise exception 'TRANSICION_INVALIDA: el trámite no está suspendido';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'DATO_INVALIDO: indicá el motivo para reanudar';
  end if;
  v_previo := public.estado_previo_suspension(p_tramite);
  if v_previo is null then
    raise exception 'NO_ENCONTRADO: no se encontró el estado previo a la suspensión';
  end if;
  perform public.cambiar_estado(p_tramite, v_previo, p_motivo, p_version);
  return v_previo;
end;
$$;

revoke all on function public.estado_previo_suspension(uuid) from public, anon;
revoke all on function public.reanudar_tramite(uuid, text, int) from public, anon;
grant execute on function public.estado_previo_suspension(uuid) to authenticated;
grant execute on function public.reanudar_tramite(uuid, text, int) to authenticated;
