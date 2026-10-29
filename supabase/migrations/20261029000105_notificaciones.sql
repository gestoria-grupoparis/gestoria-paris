-- Notificaciones (spec: tabla notificaciones, Etapa 2; gap E3). Se generan por triggers ante
-- eventos clave y cada perfil ve solo las suyas (RLS). Única escritura del usuario: marcarlas
-- como leídas por RPC. Se publican en supabase_realtime para la campana del shell.

create table public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  tipo text not null check (tipo in ('asignado', 'observado', 'sin_fondos', 'presupuesto_cargado')),
  tramite_id uuid references public.tramites (id),
  mensaje text not null,
  created_at timestamptz not null default now(),
  leida_at timestamptz
);

create index notificaciones_perfil_idx on public.notificaciones (perfil_id, created_at desc);
create index notificaciones_no_leidas_idx on public.notificaciones (perfil_id) where leida_at is null;

alter table public.notificaciones enable row level security;
revoke all on public.notificaciones from public, anon, authenticated;
grant select on public.notificaciones to authenticated;

create policy notificaciones_select on public.notificaciones for select to authenticated
  using (perfil_id = auth.uid());

-- Inserta un aviso para cada destinatario distinto del actor (nadie se avisa a sí mismo).
create function public.notificar(p_perfiles uuid[], p_tipo text, p_tramite uuid, p_mensaje text)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.notificaciones (perfil_id, tipo, tramite_id, mensaje)
  select distinct x, p_tipo, p_tramite, p_mensaje
    from unnest(p_perfiles) as x
   where x is not null
     and x is distinct from auth.uid()
     and exists (select 1 from public.perfiles p where p.id = x and p.activo);
$$;

-- Perfiles activos con el rol dado y alcance sobre la empresa/sucursal del trámite.
create function public.perfiles_con_alcance(p_tramite uuid, p_roles text[])
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p.id), '{}')
    from public.tramites t
    join public.alcances a on a.empresa_id = t.empresa_id
                          and (a.sucursal_id is null or a.sucursal_id = t.sucursal_id)
    join public.perfiles p on p.id = a.perfil_id and p.activo and p.rol = any (p_roles)
   where t.id = p_tramite;
$$;

create function public.notificar_tramite() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_visible boolean := new.estado not in ('borrador', 'observado', 'rechazado', 'cancelado');
begin
  -- Asignación: la gestora pasa a ver el trámite (autorización o reasignación).
  if new.gestora_id is not null and v_visible
     and (tg_op = 'INSERT'
          or new.gestora_id is distinct from old.gestora_id
          or old.estado in ('borrador', 'observado')) then
    perform public.notificar(array[new.gestora_id], 'asignado', new.id,
      format('Te asignaron el trámite %s (%s)', new.numero, new.vehiculo_desc));
  end if;

  if new.estado = 'observado' and (tg_op = 'INSERT' or old.estado <> 'observado') then
    perform public.notificar(array[new.creado_por], 'observado', new.id,
      format('El trámite %s fue observado', new.numero));
  end if;
  return null;
end;
$$;

create trigger trg_notificar after insert or update of estado, gestora_id on public.tramites
  for each row execute function public.notificar_tramite();

create function public.notificar_presupuesto() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites;
  v_situacion text;
begin
  select * into v_t from public.tramites where id = new.tramite_id;

  perform public.notificar(public.perfiles_con_alcance(v_t.id, array['gerencia']),
    'presupuesto_cargado', v_t.id,
    case when new.version = 1
         then format('Presupuesto cargado en %s: listo para autorizar el pago', v_t.numero)
         else format('Cambió el presupuesto de %s (versión %s)', v_t.numero, new.version) end);

  select f.situacion into v_situacion
    from public.v_tramite_finanzas_base f where f.tramite_id = v_t.id;
  if v_situacion = 'sin_fondos' then
    perform public.notificar(
      public.perfiles_con_alcance(v_t.id, array['gerencia']) || v_t.gestora_id,
      'sin_fondos', v_t.id,
      format('%s quedó sin fondos: no presentar hasta cargar fondos', v_t.numero));
  end if;
  return null;
end;
$$;

create trigger trg_notificar after insert on public.presupuestos
  for each row execute function public.notificar_presupuesto();

-- Marca como leídas las notificaciones propias (todas si p_ids es null). Devuelve cuántas.
create function public.marcar_notificaciones_leidas(p_ids uuid[] default null)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if public.mi_rol() is null then
    raise exception 'SIN_PERMISO: perfil inexistente o inactivo';
  end if;
  update public.notificaciones
     set leida_at = now()
   where perfil_id = auth.uid()
     and leida_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.notificar(uuid[], text, uuid, text),
  public.perfiles_con_alcance(uuid, text[]), public.notificar_tramite(),
  public.notificar_presupuesto(), public.marcar_notificaciones_leidas(uuid[])
  from public, anon, authenticated;
grant execute on function public.marcar_notificaciones_leidas(uuid[]) to authenticated;

alter publication supabase_realtime add table public.notificaciones;
