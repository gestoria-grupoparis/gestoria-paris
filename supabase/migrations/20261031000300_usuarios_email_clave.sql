-- Usuarios: gerencia/admin ven el email de cada cuenta y pueden darle una contraseña nueva
-- (temporal: la persona la cambia al entrar). Sin depender de emails de recuperación.

create function public.emails_usuarios()
returns table (id uuid, email text, ultimo_ingreso timestamptz, debe_cambiar_clave boolean)
language sql stable security definer
set search_path = public
as $$
  select p.id, u.email::text, u.last_sign_in_at, p.debe_cambiar_clave
    from public.perfiles p
    join auth.users u on u.id = p.id
   where coalesce(public.mi_rol() in ('admin', 'gerencia'), false)
$$;

revoke execute on function public.emails_usuarios() from public, anon;
grant execute on function public.emails_usuarios() to authenticated;

create function public.restablecer_clave(p_perfil uuid, p_clave text, p_motivo text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.bloquear_perfil_gestionable(p_perfil);
  if p_perfil = auth.uid() then
    raise exception 'DATO_INVALIDO: tu propia contraseña la cambiás desde "Cambiar contraseña"';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: indicá el motivo';
  end if;
  if p_clave is null or length(p_clave) < 10 or p_clave !~ '[A-Za-z]' or p_clave !~ '[0-9]' then
    raise exception 'DATO_INVALIDO: la contraseña nueva necesita al menos 10 caracteres, con letras y números';
  end if;

  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now() where id = p_perfil;
  perform set_config('app.motivo', 'Contraseña restablecida: ' || v_motivo, true);
  update public.perfiles set debe_cambiar_clave = true where id = p_perfil;
end;
$$;

revoke execute on function public.restablecer_clave(uuid, text, text) from public, anon;
grant execute on function public.restablecer_clave(uuid, text, text) to authenticated;
