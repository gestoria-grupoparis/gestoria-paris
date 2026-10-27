-- Operaciones (ventas) y trámites: tablas, marcas documentales y RPC de alta.
-- Organizado en secciones; las tareas siguientes agregan RPC de ciclo de vida al final.
-- Grants y RLS se definen en 20261027000700_rls.sql.

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

-- Una operación agrupa los trámites de la misma venta (caso M): única por (empresa, oferta).
create table public.operaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  sucursal_id uuid not null references public.sucursales (id),
  cliente_nombre text not null,
  cuenta_personal text not null,
  oferta_ref text not null,
  referencia_mail text,
  created_at timestamptz not null default now(),
  unique (empresa_id, oferta_ref),
  -- Destino de la FK compuesta de tramites (empresa y sucursal copiadas de la operación).
  unique (id, empresa_id, sucursal_id)
);

-- Correlativo del número visible del trámite (T-<año AR>-<00000>).
create sequence public.seq_tramite;

create table public.tramites (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  operacion_id uuid not null,
  tipo_id uuid not null references public.tipos_tramite (id),
  -- Copias de la operación: la FK compuesta garantiza que coincidan.
  empresa_id uuid not null,
  sucursal_id uuid not null,
  estado text not null default 'borrador' check (estado in (
    'borrador', 'observado', 'autorizado', 'en_gestoria', 'presentado', 'finalizado_registro',
    'devuelto', 'cerrado', 'suspendido', 'cancelado', 'rechazado'
  )),
  vehiculo_desc text not null,
  dominio text,
  chasis text,
  gestora_id uuid references public.perfiles (id),
  responsable_id uuid references public.perfiles (id),
  creado_por uuid not null references public.perfiles (id),
  autorizado_por uuid references public.perfiles (id),
  autorizado_at timestamptz,
  orden_compromiso bigint,
  pago_final_at timestamptz,
  version int not null default 1,
  idem_key uuid not null unique,
  created_at timestamptz not null default now(),
  foreign key (operacion_id, empresa_id, sucursal_id)
    references public.operaciones (id, empresa_id, sucursal_id)
);

-- Caso J: un solo trámite vivo por operación, tipo y vehículo (dominio o, si no hay, chasis).
create unique index ux_tramite_dup
  on public.tramites (operacion_id, tipo_id, coalesce(upper(dominio), upper(chasis), ''))
  where estado not in ('cancelado', 'rechazado');

-- Marcas documentales (fecha + usuario); no bloquean el flujo.
create table public.tramite_marcas (
  tramite_id uuid not null references public.tramites (id),
  marca text not null check (marca in ('legajo_recibido', 'firmado', 'entregado', 'retirado', 'recibido_admin')),
  at timestamptz not null default now(),
  por uuid not null references public.perfiles (id),
  primary key (tramite_id, marca)
);

create trigger trg_auditar after insert or update or delete on public.operaciones
  for each row execute function public.auditar();

create trigger trg_auditar after insert or update or delete on public.tramites
  for each row execute function public.auditar();

create trigger trg_auditar after insert or update or delete on public.tramite_marcas
  for each row execute function public.auditar('tramite_id');

-- =====================================================================================
-- 2. Alta de trámites
-- =====================================================================================

-- Crea un trámite en borrador. Idempotente por p_idem (caso N): si ya existe, devuelve su id.
-- Reutiliza la operación existente de (empresa, oferta) (caso M) y rechaza duplicados (caso J).
create function public.crear_tramite(
  p_idem uuid,
  p_empresa uuid,
  p_sucursal uuid,
  p_tipo text,
  p_cliente text,
  p_cuenta_personal text,
  p_oferta text,
  p_vehiculo text,
  p_dominio text default null,
  p_chasis text default null,
  p_ref_mail text default null
) returns uuid
language plpgsql security definer
set search_path = public
set timezone = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_id uuid;
  v_tipo uuid;
  v_operacion public.operaciones%rowtype;
  v_oferta text := nullif(btrim(p_oferta), '');
  v_dominio text := nullif(upper(btrim(p_dominio)), '');
  v_chasis text := nullif(upper(btrim(p_chasis)), '');
  v_restriccion text;
  v_numero text;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(p_empresa, p_sucursal) then
    raise exception 'SIN_PERMISO: no puede crear trámites en esa razón social y sucursal';
  end if;

  if p_idem is null then
    raise exception 'DATO_INVALIDO: falta la clave de idempotencia';
  end if;

  select t.id into v_id from public.tramites t where t.idem_key = p_idem;
  if found then
    return v_id;
  end if;

  if nullif(btrim(p_cliente), '') is null or nullif(btrim(p_cuenta_personal), '') is null
     or v_oferta is null or nullif(btrim(p_vehiculo), '') is null then
    raise exception 'DATO_INVALIDO: cliente, cuenta personal, oferta y vehículo son obligatorios';
  end if;

  if not exists (select 1 from public.sucursales s where s.id = p_sucursal) then
    raise exception 'NO_ENCONTRADO: sucursal inexistente';
  end if;

  select tt.id into v_tipo from public.tipos_tramite tt where tt.codigo = p_tipo and tt.activo;
  if v_tipo is null then
    raise exception 'NO_ENCONTRADO: tipo de trámite % inexistente o inactivo', p_tipo;
  end if;

  perform set_config('app.motivo', 'alta de trámite', true);

  insert into public.operaciones (empresa_id, sucursal_id, cliente_nombre, cuenta_personal, oferta_ref, referencia_mail)
  values (p_empresa, p_sucursal, btrim(p_cliente), btrim(p_cuenta_personal), v_oferta, nullif(btrim(p_ref_mail), ''))
  on conflict (empresa_id, oferta_ref) do nothing;

  select o.* into v_operacion from public.operaciones o
   where o.empresa_id = p_empresa and o.oferta_ref = v_oferta;

  if v_operacion.sucursal_id <> p_sucursal then
    raise exception 'DATO_INVALIDO: la oferta % ya pertenece a otra sucursal', v_oferta;
  end if;

  begin
    insert into public.tramites (
      numero, operacion_id, tipo_id, empresa_id, sucursal_id, vehiculo_desc, dominio, chasis,
      creado_por, idem_key
    ) values (
      'T-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_tramite')::text, 5, '0'),
      v_operacion.id, v_tipo, p_empresa, p_sucursal, btrim(p_vehiculo), v_dominio, v_chasis,
      auth.uid(), p_idem
    )
    returning id into v_id;
  exception when unique_violation then
    -- Reintento concurrente con la misma clave: devuelve el trámite que ganó, sea cual sea
    -- el índice único que haya detectado el choque primero.
    select t.id into v_id from public.tramites t where t.idem_key = p_idem;
    if found then
      return v_id;
    end if;
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion = 'ux_tramite_dup' then
      select t.numero into v_numero from public.tramites t
       where t.operacion_id = v_operacion.id and t.tipo_id = v_tipo
         and coalesce(upper(t.dominio), upper(t.chasis), '') = coalesce(v_dominio, v_chasis, '')
         and t.estado not in ('cancelado', 'rechazado');
      raise exception 'DUPLICADO: ya existe %', v_numero;
    end if;
    raise;
  end;

  return v_id;
end;
$$;

-- Aviso previo en la UI: trámites vivos de la empresa con la misma oferta o el mismo dominio,
-- limitados al alcance del usuario.
create function public.buscar_duplicados(p_empresa uuid, p_oferta text, p_dominio text)
returns table (id uuid, numero text, estado text)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.numero, t.estado
    from public.tramites t
    join public.operaciones o on o.id = t.operacion_id
   where t.empresa_id = p_empresa
     and t.estado not in ('cancelado', 'rechazado')
     and (o.oferta_ref = nullif(btrim(p_oferta), '')
          or upper(t.dominio) = nullif(upper(btrim(p_dominio)), ''))
     and public.tiene_alcance(t.empresa_id, t.sucursal_id)
   order by t.created_at, t.numero
$$;
