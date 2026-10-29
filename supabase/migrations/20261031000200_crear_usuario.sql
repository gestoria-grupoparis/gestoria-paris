-- Alta de usuarios sin Edge Function: gerencia/admin crea la cuenta con una contraseña inicial
-- y el perfil queda marcado para cambiarla en el primer ingreso. Si además se quiere que la
-- persona la elija por email, la app pide el mail de recuperación desde el navegador.
-- (La Edge Function invitar-usuario no podía validar sesiones firmadas con las llaves nuevas.)

alter table public.perfiles add column if not exists debe_cambiar_clave boolean not null default false;

create function public.crear_usuario(p_email text, p_nombre text, p_rol text, p_alcances jsonb, p_clave text)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(btrim(p_email));
  v_nombre text := nullif(btrim(p_nombre), '');
  v_id uuid := gen_random_uuid();
begin
  perform 1 from public.validar_gestion_usuario(p_rol, p_alcances);
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'DATO_INVALIDO: email inválido';
  end if;
  if v_nombre is null then
    raise exception 'DATO_INVALIDO: el nombre es obligatorio';
  end if;
  if p_clave is null or length(p_clave) < 10 or p_clave !~ '[A-Za-z]' or p_clave !~ '[0-9]' then
    raise exception 'DATO_INVALIDO: la contraseña inicial necesita al menos 10 caracteres, con letras y números';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'DUPLICADO: ya existe un usuario con ese email';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_clave, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nombre', v_nombre), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  perform set_config('app.motivo', 'Alta de usuario', true);
  insert into public.perfiles (id, nombre, rol, activo, debe_cambiar_clave) values (v_id, v_nombre, p_rol, true, true);
  perform public.reemplazar_alcances(v_id, p_rol, p_alcances);
  return v_id;
end;
$$;

revoke execute on function public.crear_usuario(text, text, text, jsonb, text) from public, anon;
grant execute on function public.crear_usuario(text, text, text, jsonb, text) to authenticated;

-- El usuario avisa que ya eligió su propia contraseña (después de auth.updateUser).
create function public.clave_cambiada() returns void
language sql security definer
set search_path = public
as $$
  update public.perfiles set debe_cambiar_clave = false where id = auth.uid() and debe_cambiar_clave
$$;

revoke execute on function public.clave_cambiada() from public, anon;
grant execute on function public.clave_cambiada() to authenticated;
