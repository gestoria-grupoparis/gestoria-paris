-- Auditoría por triggers (tabla eventos) e inmutabilidad de registros.
-- Las tareas siguientes adjuntan a sus tablas:
--   create trigger trg_auditar after insert or update or delete on <tabla>
--     for each row execute function public.auditar();
--   create trigger trg_inmutable before update or delete on <tabla>
--     for each row execute function public.impedir_modificacion();
-- Grants y RLS de eventos se definen en 20261027000700_rls.sql.

create table public.eventos (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  entidad text not null,
  entidad_id uuid,
  accion text not null check (accion in ('insert', 'update', 'delete')),
  antes jsonb,
  despues jsonb,
  motivo text
);

create index eventos_entidad_idx on public.eventos (entidad, entidad_id, at);

-- Registra la fila antes/después de cada cambio. El actor sale de auth.uid() (claims del JWT) y el
-- motivo de app.motivo, que cada RPC fija con set_config('app.motivo', p_motivo, true).
-- entidad_id se toma de la columna "id"; una tabla sin "id" pasa el nombre de su columna clave
-- como argumento del trigger (p. ej. alcances usa perfil_id).
-- SECURITY DEFINER: el evento se inserta aunque quien escribe no tenga INSERT sobre eventos.
create function public.auditar() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_columna_id text := coalesce(tg_argv[0], 'id');
begin
  insert into public.eventos (actor_id, entidad, entidad_id, accion, antes, despues, motivo)
  values (
    auth.uid(),
    tg_table_name,
    (coalesce(v_despues, v_antes) ->> v_columna_id)::uuid,
    lower(tg_op),
    v_antes,
    v_despues,
    nullif(current_setting('app.motivo', true), '')
  );
  return null;
end;
$$;

-- Rechaza UPDATE y DELETE, también para el dueño de la tabla y superusuarios.
-- Solo una migración puede saltearlo (deshabilitando el trigger explícitamente).
create function public.impedir_modificacion() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'DATO_INVALIDO: registro inmutable (%)', tg_table_name;
end;
$$;

create trigger trg_inmutable before update or delete on public.eventos
  for each row execute function public.impedir_modificacion();

create trigger trg_auditar after insert or update or delete on public.perfiles
  for each row execute function public.auditar();

create trigger trg_auditar after insert or update or delete on public.alcances
  for each row execute function public.auditar('perfil_id');
