-- Tabla de valuaciones de la DNRPA (modulo interno: gerencia y contable; la gestora no ve nada).
-- Cada disposicion es una tabla versionada e inmutable: se importa en tandas y al cerrarla no admite
-- cambios. La busqueda usa la tabla vigente a la fecha. El estimador toma el mayor entre el valor
-- declarado (o de factura) y la valuacion del vehiculo que elige el usuario (nunca se adivina).
-- Archivo solo ASCII: los acentos van con escapes U&.

create table public.valuaciones_tablas (
  id uuid primary key default gen_random_uuid(),
  disposicion text not null check (btrim(disposicion) <> ''),
  vigente_desde date not null,
  fuente_url text,
  importado_por uuid references public.perfiles (id),
  created_at timestamptz not null default now(),
  filas int not null default 0 check (filas >= 0),
  completa boolean not null default false,
  unique (disposicion, vigente_desde)
);

create table public.valuaciones (
  tabla_id uuid not null references public.valuaciones_tablas (id),
  tipo_vehiculo text not null check (tipo_vehiculo in ('auto', 'moto')),
  mtm text not null check (btrim(mtm) <> ''),
  marca text not null,
  modelo text not null,
  version text not null default '',
  anio int not null check (anio = 0 or anio between 1950 and 2100),
  valor_cents bigint not null check (valor_cents > 0),
  busqueda text generated always as (lower(marca || ' ' || modelo || ' ' || version)) stored,
  primary key (tabla_id, mtm, anio)
);

create index valuaciones_marca_idx on public.valuaciones (tabla_id, lower(marca), anio);
create index valuaciones_tablas_vigencia_idx on public.valuaciones_tablas (vigente_desde desc) where completa;

create trigger trg_auditar after insert or update or delete on public.valuaciones_tablas
  for each row execute function public.auditar();

-- =====================================================================================
-- Importacion en tandas (~2000 filas por llamada). La primera crea la tabla; las siguientes
-- con la misma disposicion y vigencia agregan; p_final = true la cierra. Reintentar una tanda
-- no duplica ni pisa valores (on conflict do nothing).
-- =====================================================================================

create function public.importar_valuaciones(
  p_disposicion text, p_vigente_desde date, p_fuente_url text, p_filas jsonb, p_final boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.valuaciones_tablas;
begin
  if coalesce(public.mi_rol() = 'gerencia', false) is false then
    raise exception 'SIN_PERMISO: solo gerencia importa la tabla de valuaciones';
  end if;
  if nullif(btrim(p_disposicion), '') is null or p_vigente_desde is null then
    raise exception 'DATO_INVALIDO: indica la disposicion y la fecha de vigencia';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 5000 then
    raise exception 'DATO_INVALIDO: las filas deben ser una lista de hasta 5000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_filas) e
     where nullif(btrim(e ->> 'mtm'), '') is null or nullif(btrim(e ->> 'marca'), '') is null
        or coalesce(e ->> 'tipo_vehiculo', '') not in ('auto', 'moto')
        or coalesce(e ->> 'valor_cents', '') !~ '^[0-9]{1,15}$' or (e ->> 'valor_cents')::bigint <= 0
        or coalesce(e ->> 'anio', '') !~ '^[0-9]{1,4}$'
  ) then
    raise exception 'DATO_INVALIDO: hay filas incompletas o con valores no validos';
  end if;

  select * into v_t from public.valuaciones_tablas
   where disposicion = btrim(p_disposicion) and vigente_desde = p_vigente_desde
   for update;
  if found and v_t.completa then
    raise exception 'DUPLICADO: esa tabla ya se importo completa; las tablas anteriores no se modifican';
  end if;
  if not found then
    insert into public.valuaciones_tablas (disposicion, vigente_desde, fuente_url, importado_por)
    values (btrim(p_disposicion), p_vigente_desde, nullif(btrim(p_fuente_url), ''), auth.uid())
    returning * into v_t;
  end if;

  insert into public.valuaciones (tabla_id, tipo_vehiculo, mtm, marca, modelo, version, anio, valor_cents)
  select v_t.id, e ->> 'tipo_vehiculo', btrim(e ->> 'mtm'), btrim(e ->> 'marca'), coalesce(btrim(e ->> 'modelo'), ''),
         coalesce(btrim(e ->> 'version'), ''), (e ->> 'anio')::int, (e ->> 'valor_cents')::bigint
    from jsonb_array_elements(p_filas) e
  on conflict do nothing;

  update public.valuaciones_tablas
     set filas = (select count(*) from public.valuaciones where tabla_id = v_t.id),
         completa = coalesce(p_final, false)
   where id = v_t.id
  returning * into v_t;
  return jsonb_build_object('tabla_id', v_t.id, 'filas', v_t.filas);
end;
$$;

-- Tabla vigente a la fecha: la completa de vigencia mas reciente que no sea posterior.
create function public.tabla_valuaciones_vigente(p_fecha date) returns uuid
language sql stable
set search_path = public
as $$
  select id from public.valuaciones_tablas
   where completa and vigente_desde <= p_fecha
   order by vigente_desde desc, created_at desc
   limit 1
$$;

-- Busqueda por palabras (todas deben aparecer en marca, modelo o version). Hasta 50 resultados.
create function public.buscar_vehiculo(p_texto text, p_anio int, p_fecha date)
returns table (tabla_id uuid, disposicion text, tipo_vehiculo text, mtm text, marca text, modelo text,
               version text, anio int, valor_cents bigint)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_tabla uuid;
  v_palabras text[];
begin
  if not public.es_interno() then
    raise exception 'SIN_PERMISO: solo gerencia o contable consultan valuaciones';
  end if;
  v_palabras := array_remove(regexp_split_to_array(lower(btrim(coalesce(p_texto, ''))), '\s+'), '');
  if coalesce(array_length(v_palabras, 1), 0) = 0 then
    return;
  end if;
  v_tabla := public.tabla_valuaciones_vigente(coalesce(p_fecha, current_date));
  return query
  select v.tabla_id, t.disposicion, v.tipo_vehiculo, v.mtm, v.marca, v.modelo, v.version, v.anio, v.valor_cents
    from public.valuaciones v
    join public.valuaciones_tablas t on t.id = v.tabla_id
   where v.tabla_id = v_tabla
     and (p_anio is null or v.anio = p_anio)
     and not exists (select 1 from unnest(v_palabras) w
                      where strpos(v.busqueda, w) = 0)
   order by v.marca, v.modelo, v.version, v.anio
   limit 50;
end;
$$;

-- =====================================================================================
-- Estimador: nueva firma con el vehiculo elegido (tabla, mtm, anio). La base del arancel es el
-- mayor entre el valor declarado y la valuacion (0 km: factura vs tabla; transferencia: declarado
-- vs tabla). Sin vehiculo elegido se comporta igual que antes.
-- =====================================================================================

drop function public.estimar_tramite(uuid, bigint, bigint, text, text, text);

create function public.estimar_tramite(
  p_tramite uuid, p_valor bigint, p_prenda bigint, p_vehiculo text, p_destino text, p_provincia text default null,
  p_tabla uuid default null, p_mtm text default null, p_anio int default null
) returns uuid
language plpgsql security definer
set search_path = public
set timezone = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_t record;
  v_prov text;
  v_e jsonb;
  v_id uuid;
  v_val_cents bigint;
  v_val_mtm text;
  v_val_anio int;
  v_val_disp text;
  v_val_tabla uuid;
  v_base bigint;
  v_entrada jsonb;
  v_lineas jsonb;
begin
  if not public.es_interno() then
    raise exception 'SIN_PERMISO: solo gerencia o contable estiman costos';
  end if;
  select t.id, t.empresa_id, tt.codigo, s.provincia into v_t
    from public.tramites t
    join public.tipos_tramite tt on tt.id = t.tipo_id
    join public.sucursales s on s.id = t.sucursal_id
   where t.id = p_tramite
   for update of t;
  if not found or not public.tiene_alcance(v_t.empresa_id, null) then
    raise exception 'NO_ENCONTRADO: tramite inexistente';
  end if;
  if coalesce(p_vehiculo, 'auto') not in ('auto', 'moto') then
    raise exception 'DATO_INVALIDO: tipo de vehiculo desconocido';
  end if;
  if coalesce(p_destino, 'cliente') not in ('cliente', 'habitualista_08', 'reventa_90') then
    raise exception 'DATO_INVALIDO: destino desconocido';
  end if;
  if p_provincia is not null and p_provincia not in ('San Luis', 'San Juan', 'Mendoza', U&'C\00F3rdoba') then
    raise exception 'DATO_INVALIDO: provincia no admitida';
  end if;
  if coalesce(p_valor, 0) < 0 or coalesce(p_prenda, 0) < 0 then
    raise exception 'DATO_INVALIDO: los importes no pueden ser negativos';
  end if;
  if p_mtm is not null then
    select v.valor_cents, v.mtm, v.anio, t.disposicion, t.id into v_val_cents, v_val_mtm, v_val_anio, v_val_disp, v_val_tabla
      from public.valuaciones v join public.valuaciones_tablas t on t.id = v.tabla_id
     where v.tabla_id = p_tabla and v.mtm = p_mtm and v.anio = p_anio;
    if not found then
      raise exception 'DATO_INVALIDO: el vehiculo elegido no figura en la tabla de valuaciones';
    end if;
  end if;

  v_prov := coalesce(p_provincia, v_t.provincia);
  v_base := nullif(greatest(coalesce(p_valor, 0), coalesce(v_val_cents, 0)), 0);
  v_e := public.calcular_estimado(v_t.codigo, coalesce(p_vehiculo, 'auto'), v_prov, v_base, p_prenda,
                                  coalesce(p_destino, 'cliente'), current_date);
  v_entrada := jsonb_build_object('valor_cents', p_valor::text, 'prenda_cents', p_prenda::text, 'vehiculo', coalesce(p_vehiculo, 'auto'),
                                  'destino', coalesce(p_destino, 'cliente'), 'provincia', v_prov);
  v_lineas := v_e -> 'lineas';
  if v_val_mtm is not null then
    v_entrada := v_entrada || jsonb_build_object('tabla_id', v_val_tabla, 'disposicion', v_val_disp,
                                                 'mtm', v_val_mtm, 'anio', v_val_anio, 'valuacion_cents', v_val_cents::text);
    select jsonb_agg(case when l ->> 'concepto' = 'arancel'
                          then l || jsonb_build_object(
                                 'valuacion', U&'Valuaci\00F3n DNRPA ' || v_val_disp || U&' \2014 ' || v_val_mtm
                                              || ' (' || case when v_val_anio = 0 then '0 km' else v_val_anio::text end || ')',
                                 'base_origen', case when v_val_cents >= coalesce(p_valor, 0) then 'valuacion' else 'declarado' end)
                          else l end order by o)
      into v_lineas
      from jsonb_array_elements(v_lineas) with ordinality as x(l, o);
  end if;

  insert into public.estimados (tramite_id, version, entrada, lineas, total_cents, confianza, creado_por)
  values (p_tramite,
          coalesce((select max(version) from public.estimados where tramite_id = p_tramite), 0) + 1,
          v_entrada, v_lineas, (v_e ->> 'total_cents')::bigint, v_e ->> 'confianza', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================================
-- Grants y RLS
-- =====================================================================================

revoke all on public.valuaciones_tablas, public.valuaciones from public, anon, authenticated;
grant select on public.valuaciones_tablas, public.valuaciones to authenticated;
alter table public.valuaciones_tablas enable row level security;
alter table public.valuaciones enable row level security;
create policy valuaciones_tablas_select on public.valuaciones_tablas for select to authenticated using (public.es_interno());
create policy valuaciones_select on public.valuaciones for select to authenticated using (public.es_interno());

revoke all on function public.importar_valuaciones(text, date, text, jsonb, boolean),
  public.tabla_valuaciones_vigente(date), public.buscar_vehiculo(text, int, date),
  public.estimar_tramite(uuid, bigint, bigint, text, text, text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.importar_valuaciones(text, date, text, jsonb, boolean),
  public.buscar_vehiculo(text, int, date),
  public.estimar_tramite(uuid, bigint, bigint, text, text, text, uuid, text, int) to authenticated;
