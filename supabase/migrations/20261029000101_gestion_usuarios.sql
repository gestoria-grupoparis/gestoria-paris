-- Gestión de usuarios (admin y gerencia): alta del perfil de un usuario invitado, edición de rol
-- y alcances, activación/desactivación. Todo por RPC SECURITY DEFINER; la auditoría la dejan los
-- triggers de perfiles y alcances con el motivo de app.motivo.
--
-- Reglas:
--   * admin gestiona a cualquiera.
--   * gerencia no crea ni toca administradores, solo otorga alcances dentro de los suyos y solo
--     gestiona perfiles cuyos alcances actuales también estén dentro de los suyos.
--   * nadie se desactiva ni se cambia el rol a sí mismo.
-- La invitación por email (auth.users) la hace la Edge Function invitar-usuario; acá solo el perfil.

-- Valida quién llama contra el rol destino y los alcances pedidos; devuelve los alcances normalizados.
create function public.validar_gestion_usuario(p_rol text, p_alcances jsonb)
returns table (empresa_id uuid, sucursal_id uuid)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_yo text := public.mi_rol();
  v_item jsonb;
  v_emp uuid;
  v_suc uuid;
begin
  if coalesce(v_yo in ('admin', 'gerencia'), false) is false then
    raise exception 'SIN_PERMISO: solo administración o gerencia gestionan usuarios';
  end if;
  if p_rol is null or p_rol not in ('gerencia', 'contable', 'gestora', 'comercial', 'admin') then
    raise exception 'DATO_INVALIDO: rol inválido (%)', p_rol;
  end if;
  if p_rol = 'admin' and v_yo <> 'admin' then
    raise exception 'SIN_PERMISO: solo administración crea administradores';
  end if;
  if p_alcances is null or jsonb_typeof(p_alcances) <> 'array' then
    raise exception 'DATO_INVALIDO: los alcances deben ser una lista';
  end if;

  for v_item in select * from jsonb_array_elements(p_alcances) loop
    begin
      v_emp := (v_item ->> 'empresa_id')::uuid;
      v_suc := nullif(v_item ->> 'sucursal_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'DATO_INVALIDO: alcance con identificador inválido';
    end;
    if v_emp is null then
      raise exception 'DATO_INVALIDO: cada alcance necesita una razón social';
    end if;
    if not exists (select 1 from public.empresas e where e.id = v_emp) then
      raise exception 'NO_ENCONTRADO: razón social inexistente';
    end if;
    if v_suc is not null and not exists (select 1 from public.sucursales s where s.id = v_suc) then
      raise exception 'NO_ENCONTRADO: sucursal inexistente';
    end if;
    if v_yo = 'gerencia' and not exists (
      select 1 from public.alcances a
       where a.perfil_id = auth.uid() and a.empresa_id = v_emp
         and (a.sucursal_id is null or a.sucursal_id = v_suc)
    ) then
      raise exception 'EMPRESA_DISTINTA: no podés otorgar un alcance que no tenés';
    end if;
    empresa_id := v_emp;
    sucursal_id := v_suc;
    return next;
  end loop;
end;
$$;

-- Comprueba que quien llama pueda gestionar al perfil existente (bloqueándolo); devuelve su rol.
create function public.bloquear_perfil_gestionable(p_perfil uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo text := public.mi_rol();
  v_rol text;
begin
  if coalesce(v_yo in ('admin', 'gerencia'), false) is false then
    raise exception 'SIN_PERMISO: solo administración o gerencia gestionan usuarios';
  end if;
  select p.rol into v_rol from public.perfiles p where p.id = p_perfil for update;
  if not found then
    raise exception 'NO_ENCONTRADO: usuario inexistente';
  end if;
  if v_yo = 'gerencia' then
    if v_rol = 'admin' then
      raise exception 'SIN_PERMISO: gerencia no gestiona administradores';
    end if;
    if exists (
      select 1 from public.alcances a
       where a.perfil_id = p_perfil
         and not exists (select 1 from public.alcances m
                          where m.perfil_id = auth.uid() and m.empresa_id = a.empresa_id
                            and (m.sucursal_id is null or m.sucursal_id = a.sucursal_id))
    ) then
      raise exception 'EMPRESA_DISTINTA: el usuario tiene alcances fuera de los tuyos';
    end if;
  end if;
  return v_rol;
end;
$$;

create function public.reemplazar_alcances(p_perfil uuid, p_rol text, p_alcances jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  create temporary table if not exists _alcances_nuevos (empresa_id uuid, sucursal_id uuid) on commit drop;
  truncate _alcances_nuevos;
  insert into _alcances_nuevos select distinct v.empresa_id, v.sucursal_id from public.validar_gestion_usuario(p_rol, p_alcances) v;
  -- Si hay "toda la empresa", las sucursales sueltas de esa empresa sobran.
  delete from _alcances_nuevos n
   where n.sucursal_id is not null
     and exists (select 1 from _alcances_nuevos t where t.empresa_id = n.empresa_id and t.sucursal_id is null);

  delete from public.alcances a
   where a.perfil_id = p_perfil
     and not exists (select 1 from _alcances_nuevos n
                      where n.empresa_id = a.empresa_id and n.sucursal_id is not distinct from a.sucursal_id);
  insert into public.alcances (perfil_id, empresa_id, sucursal_id)
  select p_perfil, n.empresa_id, n.sucursal_id from _alcances_nuevos n
   where not exists (select 1 from public.alcances a
                      where a.perfil_id = p_perfil and a.empresa_id = n.empresa_id
                        and a.sucursal_id is not distinct from n.sucursal_id);
end;
$$;

create function public.alta_perfil(p_id uuid, p_nombre text, p_rol text, p_alcances jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(p_nombre), '');
begin
  perform 1 from public.validar_gestion_usuario(p_rol, p_alcances);
  if v_nombre is null then
    raise exception 'DATO_INVALIDO: el nombre es obligatorio';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_id) then
    raise exception 'NO_ENCONTRADO: el usuario invitado no existe en autenticación';
  end if;
  if exists (select 1 from public.perfiles p where p.id = p_id) then
    raise exception 'DUPLICADO: ese usuario ya tiene perfil';
  end if;

  perform set_config('app.motivo', 'Alta de usuario por invitación', true);
  insert into public.perfiles (id, nombre, rol, activo) values (p_id, v_nombre, p_rol, true);
  perform public.reemplazar_alcances(p_id, p_rol, p_alcances);
end;
$$;

-- Validación previa de la Edge Function: evita mandar una invitación que después el alta rechazaría.
create function public.validar_alta_usuario(p_rol text, p_alcances jsonb)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform 1 from public.validar_gestion_usuario(p_rol, p_alcances);
end;
$$;

create function public.editar_usuario(p_perfil uuid, p_nombre text, p_rol text, p_alcances jsonb, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(p_nombre), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_rol_actual text;
begin
  v_rol_actual := public.bloquear_perfil_gestionable(p_perfil);
  perform 1 from public.validar_gestion_usuario(p_rol, p_alcances);
  if v_nombre is null then
    raise exception 'DATO_INVALIDO: el nombre es obligatorio';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo del cambio es obligatorio';
  end if;
  if p_perfil = auth.uid() and p_rol <> v_rol_actual then
    raise exception 'DATO_INVALIDO: no podés cambiarte el rol a vos mismo';
  end if;

  perform set_config('app.motivo', v_motivo, true);
  update public.perfiles p set nombre = v_nombre, rol = p_rol
   where p.id = p_perfil and (p.nombre, p.rol) is distinct from (v_nombre, p_rol);
  perform public.reemplazar_alcances(p_perfil, p_rol, p_alcances);
end;
$$;

create function public.cambiar_activo_usuario(p_perfil uuid, p_activo boolean, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.bloquear_perfil_gestionable(p_perfil);
  if p_activo is null then
    raise exception 'DATO_INVALIDO: falta indicar si queda activo';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo es obligatorio';
  end if;
  if p_perfil = auth.uid() then
    raise exception 'DATO_INVALIDO: no podés desactivarte a vos mismo';
  end if;
  perform set_config('app.motivo', v_motivo, true);
  update public.perfiles p set activo = p_activo where p.id = p_perfil and p.activo is distinct from p_activo;
end;
$$;

revoke execute on function public.validar_gestion_usuario(text, jsonb) from public, anon, authenticated;
revoke execute on function public.bloquear_perfil_gestionable(uuid) from public, anon, authenticated;
revoke execute on function public.reemplazar_alcances(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.alta_perfil(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.editar_usuario(uuid, text, text, jsonb, text) from public, anon;
revoke execute on function public.cambiar_activo_usuario(uuid, boolean, text) from public, anon;
grant execute on function public.alta_perfil(uuid, text, text, jsonb) to authenticated;
grant execute on function public.editar_usuario(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.cambiar_activo_usuario(uuid, boolean, text) to authenticated;
revoke execute on function public.validar_alta_usuario(text, jsonb) from public, anon;
grant execute on function public.validar_alta_usuario(text, jsonb) to authenticated;
