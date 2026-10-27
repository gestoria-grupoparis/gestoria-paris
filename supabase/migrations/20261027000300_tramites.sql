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

-- Correlativo del número visible del trámite (T-<año AR>-<00000>), que reinicia cada año
-- (spec E). Una fila por año; se incrementa con upsert ... returning, que toma el lock de la
-- fila y serializa altas concurrentes del mismo año.
create table public.contadores_tramite (
  anio int primary key check (anio between 2000 and 9999),
  ultimo int not null check (ultimo > 0)
);

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

-- Próximo número visible para la fecha operativa dada: T-<año>-<correlativo del año>.
-- Uso interno de crear_tramite (no se otorga a authenticated en 20261027000700_rls.sql).
create function public.siguiente_numero_tramite(p_fecha date) returns text
language plpgsql
set search_path = public
as $$
declare
  v_anio int := extract(year from p_fecha)::int;
  v_n int;
begin
  insert into public.contadores_tramite as c (anio, ultimo)
  values (v_anio, 1)
  on conflict (anio) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_n;
  return 'T-' || v_anio::text || '-' || lpad(v_n::text, 5, '0');
end;
$$;

revoke execute on function public.siguiente_numero_tramite(date) from public;

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
      public.siguiente_numero_tramite(current_date),
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

-- Aviso previo en la UI: trámites vivos de la empresa con la misma oferta o el mismo dominio.
-- Solo para quienes pueden crear trámites (gerencia y contable, que son quienes ven el aviso)
-- y limitado a su alcance: una gestora o un comercial no deben poder sondear trámites ajenos.
create function public.buscar_duplicados(p_empresa uuid, p_oferta text, p_dominio text)
returns table (id uuid, numero text, estado text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia y contable consultan duplicados';
  end if;

  return query
  select t.id, t.numero, t.estado
    from public.tramites t
    join public.operaciones o on o.id = t.operacion_id
   where t.empresa_id = p_empresa
     and t.estado not in ('cancelado', 'rechazado')
     and (o.oferta_ref = nullif(btrim(p_oferta), '')
          or upper(t.dominio) = nullif(upper(btrim(p_dominio)), ''))
     and public.tiene_alcance(t.empresa_id, t.sucursal_id)
   order by t.created_at, t.numero;
end;
$$;

-- =====================================================================================
-- 3. Ciclo de vida: estados, autorización, marcas y reasignación
-- =====================================================================================
-- Toda RPC que modifica un trámite recibe p_version (bloqueo optimista, caso O): bloquea la
-- fila, compara la versión y, si tuvo éxito, la incrementa.

-- Tabla de transiciones de cambiar_estado (spec D). A "autorizado" solo se llega por
-- autorizar_tramite. Desde "suspendido" la tabla habilita volver a cualquier estado que se
-- pueda suspender; cambiar_estado restringe además el destino al estado previo a la suspensión.
create function public.transicion_permitida(
  p_desde text,
  p_hacia text,
  p_rol text,
  p_es_gestora_asignada boolean
) returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(case
    when p_rol in ('gerencia', 'contable') then
      (p_desde, p_hacia) in (
        ('borrador', 'observado'), ('borrador', 'rechazado'),
        ('observado', 'borrador'),
        ('autorizado', 'en_gestoria'),
        ('autorizado', 'presentado'), ('en_gestoria', 'presentado'),
        ('presentado', 'finalizado_registro'),
        ('finalizado_registro', 'devuelto'),
        ('devuelto', 'cerrado')
      )
      or (p_hacia in ('suspendido', 'cancelado')
          and p_desde not in ('cerrado', 'cancelado', 'rechazado', p_hacia))
      or (p_desde = 'suspendido'
          and p_hacia in ('borrador', 'observado', 'autorizado', 'en_gestoria', 'presentado',
                          'finalizado_registro', 'devuelto'))
    when p_rol = 'gestora' and p_es_gestora_asignada then
      (p_desde, p_hacia) in (
        ('autorizado', 'presentado'), ('en_gestoria', 'presentado'),
        ('presentado', 'finalizado_registro')
      )
    else false
  end, false)
$$;

-- true si p_perfil es un perfil activo con rol gestora (destino de una asignación).
create function public.es_gestora_activa(p_perfil uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.perfiles p where p.id = p_perfil and p.activo and p.rol = 'gestora')
$$;

-- Uso interno de autorizar_tramite y reasignar_gestora: no se expone a los clientes.
revoke execute on function public.es_gestora_activa(uuid) from public;

-- Autoriza un trámite en borrador y le asigna la gestora (regla 1, flujo 1).
create function public.autorizar_tramite(p_tramite uuid, p_gestora uuid, p_version int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance autorizan trámites';
  end if;

  if v_t.version is distinct from p_version then
    raise exception 'VERSION_CONFLICTO: otro usuario modificó este trámite; recargá';
  end if;

  if v_t.estado <> 'borrador' then
    raise exception 'TRANSICION_INVALIDA: solo se autoriza un trámite en borrador (está %)', v_t.estado;
  end if;

  if not public.es_gestora_activa(p_gestora) then
    raise exception 'DATO_INVALIDO: la gestora asignada debe ser un perfil activo con rol gestora';
  end if;

  -- Sin motivo propio: se limpia para que la auditoría no herede uno anterior de la transacción.
  perform set_config('app.motivo', '', true);

  update public.tramites
     set estado = 'autorizado',
         gestora_id = p_gestora,
         autorizado_por = auth.uid(),
         autorizado_at = now(),
         version = version + 1
   where id = p_tramite;
end;
$$;

-- Cambia el estado según transicion_permitida. Si el rol del usuario no puede hacer una
-- transición que otro rol sí podría, es SIN_PERMISO; si nadie puede, TRANSICION_INVALIDA.
create function public.cambiar_estado(p_tramite uuid, p_estado text, p_motivo text, p_version int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
  v_asignada boolean;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_previo text;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  v_asignada := v_rol = 'gestora' and v_t.gestora_id = auth.uid();
  if not (coalesce(v_rol in ('gerencia', 'contable'), false)
          and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id))
     and not coalesce(v_asignada, false) then
    raise exception 'SIN_PERMISO: no puede cambiar el estado de este trámite';
  end if;

  if v_t.version is distinct from p_version then
    raise exception 'VERSION_CONFLICTO: otro usuario modificó este trámite; recargá';
  end if;

  if not public.transicion_permitida(v_t.estado, p_estado, v_rol, coalesce(v_asignada, false)) then
    if public.transicion_permitida(v_t.estado, p_estado, 'gerencia', false) then
      raise exception 'SIN_PERMISO: su rol no puede pasar el trámite de % a %', v_t.estado, p_estado;
    end if;
    raise exception 'TRANSICION_INVALIDA: no se puede pasar de % a %', v_t.estado, p_estado;
  end if;

  if v_t.estado = 'suspendido' and p_estado <> 'cancelado' then
    -- Estado previo: el "antes" de la última actualización que suspendió el trámite.
    select e.antes ->> 'estado' into v_previo
      from public.eventos e
     where e.entidad = 'tramites' and e.entidad_id = p_tramite and e.accion = 'update'
       and e.despues ->> 'estado' = 'suspendido' and e.antes ->> 'estado' <> 'suspendido'
     order by e.id desc
     limit 1;
    if v_previo is distinct from p_estado then
      raise exception 'TRANSICION_INVALIDA: un trámite suspendido solo vuelve a su estado previo (%)',
        coalesce(v_previo, 'desconocido');
    end if;
  end if;

  if v_motivo is null and (
       (v_t.estado = 'borrador' and p_estado in ('observado', 'rechazado'))
       or p_estado in ('suspendido', 'cancelado')
       or v_t.estado = 'suspendido') then
    raise exception 'DATO_INVALIDO: el motivo es obligatorio para pasar de % a %', v_t.estado, p_estado;
  end if;

  perform set_config('app.motivo', coalesce(v_motivo, ''), true);

  update public.tramites
     set estado = p_estado,
         version = version + 1
   where id = p_tramite;
end;
$$;

-- Marca documental (no bloquea el flujo). "retirado" la puede marcar también la gestora
-- asignada (spec F); el resto, gerencia o contable con alcance. Idempotente.
create function public.marcar(p_tramite uuid, p_marca text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
begin
  if p_marca is null or p_marca not in ('legajo_recibido', 'firmado', 'entregado', 'retirado', 'recibido_admin') then
    raise exception 'DATO_INVALIDO: marca % inexistente', p_marca;
  end if;

  select t.* into v_t from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  if not (coalesce(v_rol in ('gerencia', 'contable'), false)
          and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id))
     and not (p_marca = 'retirado' and v_rol = 'gestora' and v_t.gestora_id = auth.uid()) then
    raise exception 'SIN_PERMISO: no puede registrar la marca % en este trámite', p_marca;
  end if;

  perform set_config('app.motivo', '', true);

  insert into public.tramite_marcas (tramite_id, marca, por)
  values (p_tramite, p_marca, auth.uid())
  on conflict (tramite_id, marca) do nothing;
end;
$$;

-- Reasignación en lote (caso K): todo o nada; devuelve cuántos trámites cambiaron de gestora.
create function public.reasignar_gestora(p_tramites uuid[], p_gestora uuid, p_motivo text)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(p_tramites) x where x is not null);
  v_motivo text := nullif(btrim(p_motivo), '');
  v_encontrados int;
  v_n int;
begin
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false then
    raise exception 'SIN_PERMISO: solo gerencia o contable reasignan gestoras';
  end if;

  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo de la reasignación es obligatorio';
  end if;

  if not public.es_gestora_activa(p_gestora) then
    raise exception 'DATO_INVALIDO: la nueva gestora debe ser un perfil activo con rol gestora';
  end if;

  -- Bloquea todos los trámites en orden de id antes de validar y escribir.
  perform 1 from public.tramites t where t.id = any (v_ids) order by t.id for update;

  select count(*) into v_encontrados from public.tramites t where t.id = any (v_ids);
  if v_encontrados <> cardinality(v_ids) then
    raise exception 'NO_ENCONTRADO: % de % trámites no existen', cardinality(v_ids) - v_encontrados, cardinality(v_ids);
  end if;

  if exists (select 1 from public.tramites t
              where t.id = any (v_ids) and not public.tiene_alcance(t.empresa_id, t.sucursal_id)) then
    raise exception 'SIN_PERMISO: hay trámites fuera de su alcance';
  end if;

  perform set_config('app.motivo', v_motivo, true);

  update public.tramites t
     set gestora_id = p_gestora,
         version = t.version + 1
   where t.id = any (v_ids) and t.gestora_id is distinct from p_gestora;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
