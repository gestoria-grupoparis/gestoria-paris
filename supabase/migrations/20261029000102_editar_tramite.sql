-- Edición de los datos de un trámite en borrador u observado (gap T6): cliente, cuenta
-- personal, oferta, vehículo, dominio y chasis. Bloqueo optimista por version (caso O).
-- Cliente y cuenta personal son datos de la operación (caso M): corregirlos corrige la venta.
-- Cambiar la oferta mueve el trámite a la operación de (empresa, oferta), que se crea si falta.

create function public.editar_tramite(
  p_tramite uuid,
  p_version int,
  p_cliente text,
  p_cuenta_personal text,
  p_oferta text,
  p_vehiculo text,
  p_dominio text default null,
  p_chasis text default null,
  p_motivo text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_op public.operaciones%rowtype;
  v_cliente text := nullif(btrim(p_cliente), '');
  v_cuenta text := nullif(btrim(p_cuenta_personal), '');
  v_oferta text := nullif(btrim(p_oferta), '');
  v_vehiculo text := nullif(btrim(p_vehiculo), '');
  v_dominio text := nullif(upper(btrim(p_dominio)), '');
  v_chasis text := nullif(upper(btrim(p_chasis)), '');
  v_numero text;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance editan trámites';
  end if;

  if v_t.version is distinct from p_version then
    raise exception 'VERSION_CONFLICTO: otro usuario modificó este trámite; recargá';
  end if;

  if v_t.estado not in ('borrador', 'observado') then
    raise exception 'TRANSICION_INVALIDA: solo se edita un trámite en borrador u observado (está %)', v_t.estado;
  end if;

  if v_cliente is null or v_cuenta is null or v_oferta is null or v_vehiculo is null then
    raise exception 'DATO_INVALIDO: cliente, cuenta personal, oferta y vehículo son obligatorios';
  end if;

  perform set_config('app.motivo', coalesce(nullif(btrim(p_motivo), ''), 'edición de trámite'), true);

  insert into public.operaciones (empresa_id, sucursal_id, cliente_nombre, cuenta_personal, oferta_ref)
  values (v_t.empresa_id, v_t.sucursal_id, v_cliente, v_cuenta, v_oferta)
  on conflict (empresa_id, oferta_ref) do nothing;

  select o.* into v_op from public.operaciones o
   where o.empresa_id = v_t.empresa_id and o.oferta_ref = v_oferta
   for update;

  if v_op.sucursal_id <> v_t.sucursal_id then
    raise exception 'DATO_INVALIDO: la oferta % ya pertenece a otra sucursal', v_oferta;
  end if;

  update public.operaciones o
     set cliente_nombre = v_cliente, cuenta_personal = v_cuenta
   where o.id = v_op.id and (o.cliente_nombre, o.cuenta_personal) is distinct from (v_cliente, v_cuenta);

  begin
    update public.tramites
       set operacion_id = v_op.id,
           vehiculo_desc = v_vehiculo,
           dominio = v_dominio,
           chasis = v_chasis,
           version = version + 1
     where id = p_tramite;
  exception when unique_violation then
    select t.numero into v_numero from public.tramites t
     where t.id <> p_tramite and t.operacion_id = v_op.id and t.tipo_id = v_t.tipo_id
       and coalesce(upper(t.dominio), upper(t.chasis), '') = coalesce(v_dominio, v_chasis, '')
       and t.estado not in ('cancelado', 'rechazado');
    raise exception 'DUPLICADO: ya existe %', coalesce(v_numero, 'otro trámite con esos datos');
  end;
end;
$$;

revoke execute on function public.editar_tramite(uuid, int, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.editar_tramite(uuid, int, text, text, text, text, text, text, text) to authenticated;
