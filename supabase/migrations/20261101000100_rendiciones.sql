-- Rendiciones mensuales de la gestora: planilla (filas), comprobantes leídos y sus líneas.
-- Una rendición solo compara: nunca inserta movimientos ni toca saldos.
-- Lectura por RLS (gestora dueña; gerencia/contable por alcance); escritura solo por RPC.
-- Los archivos originales van al bucket privado "comprobantes" (carpeta = id de la rendición).

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

create table public.rendiciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  gestora_id uuid not null references public.perfiles (id),
  periodo date not null check (periodo = date_trunc('month', periodo)::date),
  honorario_unitario_cents bigint not null default 3250000 check (honorario_unitario_cents > 0),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'observada', 'aprobada')),
  motivo_observacion text,
  creado_por uuid not null references public.perfiles (id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  unique (empresa_id, gestora_id, periodo)
);

create table public.rendicion_filas (
  id uuid primary key default gen_random_uuid(),
  rendicion_id uuid not null references public.rendiciones (id) on delete cascade,
  orden int not null,
  nombre text not null,
  dominio text,
  pago_cents bigint not null default 0,
  honorarios_cents bigint not null default 0,
  tramite_id uuid references public.tramites (id),
  vinculo text not null default 'sin_vincular' check (vinculo in ('auto', 'manual', 'ambiguo', 'sin_vincular')),
  candidatos uuid[] not null default '{}'
);

create index rendicion_filas_rendicion_idx on public.rendicion_filas (rendicion_id, orden);

create table public.comprobantes (
  id uuid primary key default gen_random_uuid(),
  rendicion_id uuid not null references public.rendiciones (id) on delete cascade,
  fila_id uuid references public.rendicion_filas (id) on delete set null,
  tipo text not null default 'otro' check (tipo in (
    'recibo_dnrpa', 'retencion_sellos', 'factura_honorarios', 'factura_electronica', 'otro')),
  archivo_path text,
  archivo_sha256 text,
  pagina int not null default 1 check (pagina > 0),
  numero text,
  emisor text,
  emisor_cuit text,
  fecha date,
  total_cents bigint,
  dominio text,
  documento text,
  datos_extraidos jsonb not null default '{}'::jsonb,
  datos_confirmados jsonb,
  revision text not null default 'pendiente' check (revision in ('pendiente', 'confirmado')),
  cargado_por uuid not null references public.perfiles (id),
  revisado_por uuid references public.perfiles (id),
  created_at timestamptz not null default now()
);

create index comprobantes_rendicion_idx on public.comprobantes (rendicion_id);
create index comprobantes_archivo_idx on public.comprobantes (archivo_sha256, pagina);
create index comprobantes_numero_idx on public.comprobantes (tipo, numero) where numero is not null;

create table public.comprobante_lineas (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references public.comprobantes (id) on delete cascade,
  concepto text not null,
  importe_cents bigint not null
);

create index comprobante_lineas_comprobante_idx on public.comprobante_lineas (comprobante_id);

create trigger trg_auditar after insert or update or delete on public.rendiciones
  for each row execute function public.auditar();
create trigger trg_auditar after insert or update or delete on public.rendicion_filas
  for each row execute function public.auditar();
create trigger trg_auditar after insert or update or delete on public.comprobantes
  for each row execute function public.auditar();
create trigger trg_auditar after insert or update or delete on public.comprobante_lineas
  for each row execute function public.auditar();

-- =====================================================================================
-- 2. Visibilidad y edición
-- =====================================================================================

-- Gestora: las suyas. Gerencia/contable: las de razones sociales con alcance completo.
create function public.puede_ver_rendicion(p_rendicion uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case public.mi_rol()
             when 'gestora' then r.gestora_id = auth.uid()
             when 'gerencia' then public.tiene_alcance(r.empresa_id, null)
             when 'contable' then public.tiene_alcance(r.empresa_id, null)
             else false
           end
      from public.rendiciones r
     where r.id = p_rendicion), false)
$$;

-- Para las políticas de storage: el primer segmento del nombre del objeto es el id de la rendición.
create function public.puede_ver_rendicion_ruta(p_nombre text) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
           when split_part(coalesce(p_nombre, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.puede_ver_rendicion(split_part(p_nombre, '/', 1)::uuid)
           else false
         end
$$;

-- Bloquea la rendición y verifica que quien llama la pueda editar (borrador u observada).
create function public.rendicion_editable(p_rendicion uuid) returns public.rendiciones
language plpgsql
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype;
begin
  select r.* into v_r from public.rendiciones r where r.id = p_rendicion for update;
  if not found or not public.puede_ver_rendicion(p_rendicion) then
    raise exception 'NO_ENCONTRADO: rendición inexistente';
  end if;
  if v_r.estado not in ('borrador', 'observada') then
    raise exception 'TRANSICION_INVALIDA: la rendición está %; solo se edita en borrador u observada', v_r.estado;
  end if;
  perform set_config('app.motivo', '', true);
  return v_r;
end;
$$;

revoke execute on function public.rendicion_editable(uuid) from public;

-- =====================================================================================
-- 3. RPC
-- =====================================================================================

create function public.crear_rendicion(p_empresa uuid, p_periodo date, p_honorario bigint, p_gestora uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_rol text := public.mi_rol();
  v_gestora uuid;
  v_id uuid;
begin
  if v_rol = 'gestora' then
    v_gestora := auth.uid();
  elsif v_rol in ('gerencia', 'contable') then
    if not public.tiene_alcance(p_empresa, null) then
      raise exception 'SIN_PERMISO: sin alcance sobre esa razón social';
    end if;
    if p_gestora is null or not public.es_gestora_activa(p_gestora) then
      raise exception 'DATO_INVALIDO: elegí una gestora activa';
    end if;
    v_gestora := p_gestora;
  else
    raise exception 'SIN_PERMISO: solo la gestora, gerencia o contable crean rendiciones';
  end if;

  if not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'DATO_INVALIDO: razón social inexistente';
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
    values (p_empresa, v_gestora, date_trunc('month', p_periodo)::date, coalesce(p_honorario, 3250000), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICADO: ya existe la rendición de ese mes para esa gestora y razón social';
  end;
  return v_id;
end;
$$;

-- Reemplaza la planilla. Filas con "id" existente se actualizan (conservan sus comprobantes);
-- las demás se crean; las que no vienen se borran (sus comprobantes quedan sin asignar).
create function public.guardar_filas(p_rendicion uuid, p_filas jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype := public.rendicion_editable(p_rendicion);
  v_f jsonb;
  v_orden int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_tramite uuid;
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'DATO_INVALIDO: las filas deben ser una lista';
  end if;

  for v_f in select * from jsonb_array_elements(p_filas) loop
    v_orden := v_orden + 1;
    if nullif(btrim(v_f ->> 'nombre'), '') is null then
      raise exception 'DATO_INVALIDO: la fila % no tiene nombre', v_orden;
    end if;
    v_tramite := nullif(v_f ->> 'tramite_id', '')::uuid;
    if v_tramite is not null and not exists (
      select 1 from public.tramites t where t.id = v_tramite and t.empresa_id = v_r.empresa_id) then
      raise exception 'DATO_INVALIDO: el trámite de la fila % no es de esa razón social', v_orden;
    end if;

    v_id := nullif(v_f ->> 'id', '')::uuid;
    if v_id is not null and exists (
      select 1 from public.rendicion_filas f where f.id = v_id and f.rendicion_id = p_rendicion) then
      update public.rendicion_filas
         set orden = v_orden,
             nombre = btrim(v_f ->> 'nombre'),
             dominio = nullif(upper(btrim(v_f ->> 'dominio')), ''),
             pago_cents = coalesce((v_f ->> 'pago_cents')::bigint, 0),
             honorarios_cents = coalesce((v_f ->> 'honorarios_cents')::bigint, 0),
             tramite_id = v_tramite,
             vinculo = coalesce(v_f ->> 'vinculo', case when v_tramite is null then 'sin_vincular' else 'manual' end),
             candidatos = coalesce(array(select jsonb_array_elements_text(coalesce(v_f -> 'candidatos', '[]'::jsonb))::uuid), '{}')
       where id = v_id;
    else
      insert into public.rendicion_filas
        (rendicion_id, orden, nombre, dominio, pago_cents, honorarios_cents, tramite_id, vinculo, candidatos)
      values (
        p_rendicion, v_orden, btrim(v_f ->> 'nombre'), nullif(upper(btrim(v_f ->> 'dominio')), ''),
        coalesce((v_f ->> 'pago_cents')::bigint, 0), coalesce((v_f ->> 'honorarios_cents')::bigint, 0),
        v_tramite,
        coalesce(v_f ->> 'vinculo', case when v_tramite is null then 'sin_vincular' else 'manual' end),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_f -> 'candidatos', '[]'::jsonb))::uuid), '{}'))
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  delete from public.rendicion_filas f where f.rendicion_id = p_rendicion and not (f.id = any (v_ids));
end;
$$;

-- Alta o edición (por "id") de un comprobante con sus líneas. No controla duplicados.
create function public.guardar_comprobante(p_rendicion uuid, p_datos jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype := public.rendicion_editable(p_rendicion);
  v_id uuid := nullif(p_datos ->> 'id', '')::uuid;
  v_fila uuid := nullif(p_datos ->> 'fila_id', '')::uuid;
  v_revision text := coalesce(p_datos ->> 'revision', 'pendiente');
  v_path text := nullif(p_datos ->> 'archivo_path', '');
  v_l jsonb;
begin
  if v_fila is not null and not exists (
    select 1 from public.rendicion_filas f where f.id = v_fila and f.rendicion_id = p_rendicion) then
    raise exception 'DATO_INVALIDO: la fila no es de esta rendición';
  end if;
  if v_path is not null and split_part(v_path, '/', 1) <> p_rendicion::text then
    raise exception 'DATO_INVALIDO: el archivo no es de esta rendición';
  end if;

  if v_id is not null and exists (select 1 from public.comprobantes c where c.id = v_id) then
    if not exists (select 1 from public.comprobantes c where c.id = v_id and c.rendicion_id = p_rendicion) then
      raise exception 'NO_ENCONTRADO: comprobante inexistente en esta rendición';
    end if;
    update public.comprobantes
       set fila_id = v_fila,
           tipo = coalesce(p_datos ->> 'tipo', tipo),
           archivo_path = coalesce(v_path, archivo_path),
           archivo_sha256 = coalesce(nullif(p_datos ->> 'archivo_sha256', ''), archivo_sha256),
           pagina = coalesce((p_datos ->> 'pagina')::int, pagina),
           numero = nullif(btrim(p_datos ->> 'numero'), ''),
           emisor = nullif(btrim(p_datos ->> 'emisor'), ''),
           emisor_cuit = nullif(btrim(p_datos ->> 'emisor_cuit'), ''),
           fecha = nullif(p_datos ->> 'fecha', '')::date,
           total_cents = nullif(p_datos ->> 'total_cents', '')::bigint,
           dominio = nullif(upper(btrim(p_datos ->> 'dominio')), ''),
           documento = nullif(btrim(p_datos ->> 'documento'), ''),
           datos_extraidos = coalesce(p_datos -> 'datos_extraidos', datos_extraidos),
           datos_confirmados = case when v_revision = 'confirmado' then coalesce(p_datos -> 'datos_confirmados', p_datos - 'lineas' - 'datos_extraidos') end,
           revision = v_revision,
           revisado_por = case when v_revision = 'confirmado' then auth.uid() end
     where id = v_id;
  else
    insert into public.comprobantes (
      id, rendicion_id, fila_id, tipo, archivo_path, archivo_sha256, pagina, numero, emisor, emisor_cuit,
      fecha, total_cents, dominio, documento, datos_extraidos, datos_confirmados, revision, cargado_por, revisado_por)
    values (
      coalesce(v_id, gen_random_uuid()), p_rendicion, v_fila, coalesce(p_datos ->> 'tipo', 'otro'), v_path,
      nullif(p_datos ->> 'archivo_sha256', ''), coalesce((p_datos ->> 'pagina')::int, 1),
      nullif(btrim(p_datos ->> 'numero'), ''), nullif(btrim(p_datos ->> 'emisor'), ''),
      nullif(btrim(p_datos ->> 'emisor_cuit'), ''), nullif(p_datos ->> 'fecha', '')::date,
      nullif(p_datos ->> 'total_cents', '')::bigint, nullif(upper(btrim(p_datos ->> 'dominio')), ''),
      nullif(btrim(p_datos ->> 'documento'), ''), coalesce(p_datos -> 'datos_extraidos', '{}'::jsonb),
      case when v_revision = 'confirmado' then coalesce(p_datos -> 'datos_confirmados', p_datos - 'lineas' - 'datos_extraidos') end,
      v_revision, auth.uid(), case when v_revision = 'confirmado' then auth.uid() end)
    returning id into v_id;
  end if;

  if p_datos ? 'lineas' then
    delete from public.comprobante_lineas l where l.comprobante_id = v_id;
    for v_l in select * from jsonb_array_elements(coalesce(p_datos -> 'lineas', '[]'::jsonb)) loop
      if nullif(btrim(v_l ->> 'concepto'), '') is null or (v_l ->> 'importe_cents') is null then
        raise exception 'DATO_INVALIDO: cada línea necesita concepto e importe';
      end if;
      insert into public.comprobante_lineas (comprobante_id, concepto, importe_cents)
      values (v_id, btrim(v_l ->> 'concepto'), (v_l ->> 'importe_cents')::bigint);
    end loop;
  end if;
  return v_id;
end;
$$;

-- Gestora: borrador/observada a enviada. Gerencia/contable: enviada a observada (con motivo)
-- o a aprobada. Aprobar no crea movimientos: la rendición solo compara.
create function public.cambiar_estado_rendicion(p_rendicion uuid, p_estado text, p_motivo text, p_version int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype;
  v_rol text := public.mi_rol();
begin
  select r.* into v_r from public.rendiciones r where r.id = p_rendicion for update;
  if not found or not public.puede_ver_rendicion(p_rendicion) then
    raise exception 'NO_ENCONTRADO: rendición inexistente';
  end if;

  if p_estado = 'enviada' then
    if v_rol <> 'gestora' then
      raise exception 'SIN_PERMISO: solo la gestora envía su rendición a control';
    end if;
  elsif p_estado in ('observada', 'aprobada') then
    if coalesce(v_rol in ('gerencia', 'contable'), false) is false then
      raise exception 'SIN_PERMISO: solo gerencia o contable observan o aprueban rendiciones';
    end if;
  else
    raise exception 'DATO_INVALIDO: estado de rendición desconocido';
  end if;

  if v_r.version is distinct from p_version then
    raise exception 'VERSION_CONFLICTO: otro usuario modificó esta rendición; recargá';
  end if;

  if (p_estado = 'enviada' and v_r.estado not in ('borrador', 'observada'))
     or (p_estado in ('observada', 'aprobada') and v_r.estado <> 'enviada') then
    raise exception 'TRANSICION_INVALIDA: no se puede pasar de % a %', v_r.estado, p_estado;
  end if;

  if p_estado = 'observada' and nullif(btrim(p_motivo), '') is null then
    raise exception 'DATO_INVALIDO: observar exige un motivo';
  end if;

  perform set_config('app.motivo', coalesce(nullif(btrim(p_motivo), ''), ''), true);
  update public.rendiciones
     set estado = p_estado,
         motivo_observacion = case when p_estado = 'observada' then btrim(p_motivo) else motivo_observacion end,
         version = version + 1
   where id = p_rendicion;
end;
$$;

-- =====================================================================================
-- 4. Grants y RLS
-- =====================================================================================

revoke all on public.rendiciones, public.rendicion_filas, public.comprobantes, public.comprobante_lineas
  from public, anon, authenticated;
grant select on public.rendiciones, public.rendicion_filas, public.comprobantes, public.comprobante_lineas
  to authenticated;

alter table public.rendiciones enable row level security;
alter table public.rendicion_filas enable row level security;
alter table public.comprobantes enable row level security;
alter table public.comprobante_lineas enable row level security;

create policy rendiciones_select on public.rendiciones for select to authenticated
  using (public.puede_ver_rendicion(id));
create policy rendicion_filas_select on public.rendicion_filas for select to authenticated
  using (public.puede_ver_rendicion(rendicion_id));
create policy comprobantes_select on public.comprobantes for select to authenticated
  using (public.puede_ver_rendicion(rendicion_id));
create policy comprobante_lineas_select on public.comprobante_lineas for select to authenticated
  using (exists (select 1 from public.comprobantes c
                  where c.id = comprobante_id and public.puede_ver_rendicion(c.rendicion_id)));

revoke all on function public.puede_ver_rendicion(uuid), public.puede_ver_rendicion_ruta(text),
  public.crear_rendicion(uuid, date, bigint, uuid), public.guardar_filas(uuid, jsonb),
  public.guardar_comprobante(uuid, jsonb), public.cambiar_estado_rendicion(uuid, text, text, int)
  from public, anon;
grant execute on function public.puede_ver_rendicion(uuid), public.puede_ver_rendicion_ruta(text),
  public.crear_rendicion(uuid, date, bigint, uuid), public.guardar_filas(uuid, jsonb),
  public.guardar_comprobante(uuid, jsonb), public.cambiar_estado_rendicion(uuid, text, text, int)
  to authenticated;

-- =====================================================================================
-- 5. Storage: bucket privado y políticas (solo si existe el esquema storage)
-- =====================================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false)
    on conflict (id) do update set public = false;

    execute 'drop policy if exists comprobantes_insert on storage.objects';
    execute 'drop policy if exists comprobantes_select on storage.objects';
    execute $p$create policy comprobantes_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes' and public.puede_ver_rendicion_ruta(name))$p$;
    execute $p$create policy comprobantes_select on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes' and public.puede_ver_rendicion_ruta(name))$p$;
  end if;
end;
$$;
