-- Cuentas Habitualista y presupuestos versionados de los trámites.
-- La tabla cuentas se crea acá porque registrar_presupuesto la bloquea (spec G); los movimientos
-- llegan en 20261027000500. Las tres cuentas iniciales están en 20261027000401_cuentas_catalogos.sql.
-- Grants y RLS se definen en 20261027000700_rls.sql.

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

-- Una Habitualista por razón social (spec C). El saldo registrado se calcula:
-- saldo inicial + movimientos (no se guarda).
create table public.cuentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas (id),
  nombre text not null,
  saldo_inicial_cents bigint not null default 0,
  saldo_inicial_fecha date not null
);

create trigger trg_auditar after insert or update or delete on public.cuentas
  for each row execute function public.auditar();

-- Cada versión es un registro nuevo; la vigente es la de mayor versión. Solo INSERT.
create table public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  tramite_id uuid not null references public.tramites (id),
  version int not null check (version >= 1),
  arancel_cents bigint not null default 0 check (arancel_cents >= 0),
  prenda_cents bigint not null default 0 check (prenda_cents >= 0),
  sellado_cents bigint not null default 0 check (sellado_cents >= 0),
  otros_cents bigint not null default 0 check (otros_cents >= 0),
  total_cents bigint generated always as (arancel_cents + prenda_cents + sellado_cents + otros_cents) stored,
  motivo text,
  creado_por uuid not null references public.perfiles (id),
  created_at timestamptz not null default now(),
  unique (tramite_id, version),
  check (arancel_cents + prenda_cents + sellado_cents + otros_cents > 0)
);

create trigger trg_auditar after insert or update or delete on public.presupuestos
  for each row execute function public.auditar();

create trigger trg_inmutable before update or delete on public.presupuestos
  for each row execute function public.impedir_modificacion();

create trigger trg_inmutable_truncate before truncate on public.presupuestos
  for each statement execute function public.impedir_modificacion();

-- Prioridad de fondos: la toma cada trámite con su primer presupuesto (tramites.orden_compromiso).
create sequence public.seq_compromiso;

-- =====================================================================================
-- 2. Registro de presupuestos
-- =====================================================================================

-- Crea la siguiente versión del presupuesto del trámite y devuelve su número.
-- Bloquea primero la cuenta de la empresa (spec G) y después el trámite, para que dos
-- presupuestos sobre la misma Habitualista se serialicen y las versiones no choquen.
create function public.registrar_presupuesto(
  p_tramite uuid,
  p_arancel bigint,
  p_prenda bigint,
  p_sellado bigint,
  p_otros bigint,
  p_motivo text default null
) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
  v_motivo text := nullif(btrim(p_motivo), '');
  v_version int;
begin
  select t.empresa_id into v_empresa from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  perform 1 from public.cuentas c where c.empresa_id = v_empresa for update;
  if not found then
    raise exception 'NO_ENCONTRADO: la razón social del trámite no tiene cuenta Habitualista';
  end if;

  -- La empresa de un trámite no cambia: la cuenta bloqueada sigue siendo la suya.
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;

  if not (coalesce(v_rol in ('gerencia', 'contable'), false)
          and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id))
     and not coalesce(v_rol = 'gestora' and v_t.gestora_id = auth.uid(), false) then
    raise exception 'SIN_PERMISO: no puede cargar presupuestos en este trámite';
  end if;

  if v_t.estado not in ('autorizado', 'en_gestoria', 'presentado') then
    raise exception 'NO_AUTORIZADO: solo se presupuesta un trámite autorizado, en gestoría o presentado (está %)', v_t.estado;
  end if;

  if p_arancel is null or p_prenda is null or p_sellado is null or p_otros is null
     or least(p_arancel, p_prenda, p_sellado, p_otros) < 0 then
    raise exception 'DATO_INVALIDO: los conceptos del presupuesto son obligatorios y no pueden ser negativos';
  end if;

  -- En numeric para que una suma desbordada sea un error de negocio y no de bigint.
  if p_arancel::numeric + p_prenda + p_sellado + p_otros <= 0 then
    raise exception 'DATO_INVALIDO: el total del presupuesto debe ser mayor a cero';
  end if;
  if p_arancel::numeric + p_prenda + p_sellado + p_otros > 9223372036854775807 then
    raise exception 'DATO_INVALIDO: el total del presupuesto excede el máximo admitido';
  end if;

  select coalesce(max(p.version), 0) + 1 into v_version
    from public.presupuestos p where p.tramite_id = p_tramite;

  if v_version >= 2 and v_motivo is null then
    raise exception 'DATO_INVALIDO: una nueva versión del presupuesto requiere motivo';
  end if;

  perform set_config('app.motivo', coalesce(v_motivo, ''), true);

  insert into public.presupuestos (
    tramite_id, version, arancel_cents, prenda_cents, sellado_cents, otros_cents, motivo, creado_por
  ) values (
    p_tramite, v_version, p_arancel, p_prenda, p_sellado, p_otros, v_motivo, auth.uid()
  );

  -- El primer presupuesto define la prioridad de fondos. No es una edición del trámite:
  -- no incrementa tramites.version (no invalida lo que otro usuario tenga abierto).
  if v_version = 1 then
    update public.tramites
       set orden_compromiso = nextval('public.seq_compromiso')
     where id = p_tramite;
  end if;

  return v_version;
end;
$$;
