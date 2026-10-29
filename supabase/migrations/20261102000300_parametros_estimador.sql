-- Edicion de parametros del estimador: solo gerencia. Cada cambio es una vigencia nueva; la
-- anterior se cierra el dia previo. Los estimados ya guardados no cambian.

create function public.guardar_parametro_estimador(
  p_clave text, p_vehiculo text, p_provincia text, p_valor numeric, p_vigencia_desde date, p_fuente text, p_verificado boolean
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(public.mi_rol() = 'gerencia', false) is false then
    raise exception 'SIN_PERMISO: solo gerencia actualiza los parametros del estimador';
  end if;
  if nullif(btrim(p_fuente), '') is null then
    raise exception 'DATO_INVALIDO: indica la fuente del parametro';
  end if;
  if p_vigencia_desde is null then
    raise exception 'DATO_INVALIDO: la fecha de vigencia es obligatoria';
  end if;
  if p_valor is not null and p_valor < 0 then
    raise exception 'DATO_INVALIDO: el valor no puede ser negativo';
  end if;
  if p_clave not in (select distinct clave from public.parametros_estimador) then
    raise exception 'DATO_INVALIDO: parametro desconocido';
  end if;

  update public.parametros_estimador
     set vigencia_hasta = p_vigencia_desde - 1
   where clave = p_clave
     and vehiculo is not distinct from p_vehiculo
     and provincia is not distinct from p_provincia
     and vigencia_desde < p_vigencia_desde
     and (vigencia_hasta is null or vigencia_hasta >= p_vigencia_desde);

  begin
    insert into public.parametros_estimador (clave, vehiculo, provincia, valor, vigencia_desde, fuente, verificado, creado_por)
    values (p_clave, p_vehiculo, p_provincia, p_valor, p_vigencia_desde, btrim(p_fuente), coalesce(p_verificado, false), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICADO: ya hay un valor de ese parametro con esa fecha de vigencia';
  end;
  return v_id;
end;
$$;

revoke all on function public.guardar_parametro_estimador(text, text, text, numeric, date, text, boolean) from public, anon, authenticated;
grant execute on function public.guardar_parametro_estimador(text, text, text, numeric, date, text, boolean) to authenticated;
