-- Libro de movimientos de las cuentas Habitualista y RPC de registro: carga, pago, ajuste,
-- reintegro y reversión. Solo INSERT: una corrección es una reversión más un movimiento nuevo.
-- Toda RPC bloquea primero la fila de la cuenta (spec E, Concurrencia) y después, si hace
-- falta, la del trámite; siempre en ese orden para no generar deadlocks.
-- Grants y RLS se definen en 20261027000700_rls.sql.

-- =====================================================================================
-- 1. Tabla
-- =====================================================================================

-- importe_cents lleva signo: positivo entra a la cuenta, negativo sale.
-- El desglose (arancel/prenda/sellado/otros) es de los pagos; la reversión de un pago lo copia
-- con signo invertido, así que en ambos casos suma -importe_cents.
create table public.movimientos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas (id),
  tipo text not null check (tipo in ('carga', 'pago_tramite', 'ajuste', 'reintegro', 'reversion')),
  importe_cents bigint not null check (importe_cents <> 0),
  fecha_operacion date not null,
  tramite_id uuid references public.tramites (id),
  revierte_id uuid unique references public.movimientos (id),
  arancel_cents bigint,
  prenda_cents bigint,
  sellado_cents bigint,
  otros_cents bigint,
  es_pago_final boolean not null default false,
  motivo text,
  creado_por uuid not null references public.perfiles (id),
  created_at timestamptz not null default now(),
  idem_key uuid not null unique,

  constraint movimientos_signo_check check (
    case tipo
      when 'carga' then importe_cents > 0
      when 'reintegro' then importe_cents > 0
      when 'pago_tramite' then importe_cents < 0
      else true
    end),
  constraint movimientos_tramite_check check (
    case tipo
      when 'pago_tramite' then tramite_id is not null
      when 'reintegro' then tramite_id is not null
      when 'carga' then tramite_id is null
      when 'ajuste' then tramite_id is null
      else true
    end),
  constraint movimientos_revierte_check check ((tipo = 'reversion') = (revierte_id is not null)),
  constraint movimientos_ajuste_motivo_check check (tipo <> 'ajuste' or nullif(btrim(motivo), '') is not null),
  constraint movimientos_pago_final_check check (not es_pago_final or tipo = 'pago_tramite'),
  -- Un pago siempre trae el desglose completo, sin conceptos negativos.
  constraint movimientos_pago_desglose_check check (
    tipo <> 'pago_tramite'
    or (arancel_cents >= 0 and prenda_cents >= 0 and sellado_cents >= 0 and otros_cents >= 0)),
  -- Desglose: todo o nada, solo en pagos y reversiones, y suma exactamente -importe_cents.
  constraint movimientos_desglose_check check (
    (arancel_cents is null and prenda_cents is null and sellado_cents is null and otros_cents is null)
    or (tipo in ('pago_tramite', 'reversion')
        and arancel_cents is not null and prenda_cents is not null
        and sellado_cents is not null and otros_cents is not null
        and arancel_cents + prenda_cents + sellado_cents + otros_cents = -importe_cents))
);

create index movimientos_cuenta_idx on public.movimientos (cuenta_id, fecha_operacion);
create index movimientos_tramite_idx on public.movimientos (tramite_id) where tramite_id is not null;

-- Regla 11 / R23: un movimiento ligado a un trámite va a la cuenta de la razón social del
-- trámite. Las RPC ya derivan la cuenta; esto lo garantiza también ante inserts directos.
create function public.verificar_empresa_movimiento() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_empresa_cuenta uuid;
  v_empresa_tramite uuid;
begin
  if new.tramite_id is null then
    return new;
  end if;
  select c.empresa_id into v_empresa_cuenta from public.cuentas c where c.id = new.cuenta_id;
  select t.empresa_id into v_empresa_tramite from public.tramites t where t.id = new.tramite_id;
  if v_empresa_cuenta is distinct from v_empresa_tramite then
    raise exception 'EMPRESA_DISTINTA: el trámite y la cuenta pertenecen a razones sociales distintas';
  end if;
  return new;
end;
$$;

create trigger trg_verificar_empresa before insert or update on public.movimientos
  for each row execute function public.verificar_empresa_movimiento();

create trigger trg_auditar after insert or update or delete on public.movimientos
  for each row execute function public.auditar();

create trigger trg_inmutable before update or delete on public.movimientos
  for each row execute function public.impedir_modificacion();

create trigger trg_inmutable_truncate before truncate on public.movimientos
  for each statement execute function public.impedir_modificacion();

-- =====================================================================================
-- 2. Registro de movimientos
-- =====================================================================================
-- Todas las RPC son idempotentes por p_idem (caso N): si la clave ya existe devuelven ese
-- movimiento sin validar nada más. La clave se vuelve a buscar después de bloquear la cuenta
-- (un reintento concurrente queda en fila detrás del original) y el insert usa
-- on conflict (idem_key) do nothing como última defensa.

-- Id del movimiento con esa clave de idempotencia, o null. Exige la clave.
create function public.movimiento_por_idem(p_idem uuid) returns uuid
language plpgsql stable
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_idem is null then
    raise exception 'DATO_INVALIDO: falta la clave de idempotencia';
  end if;
  select m.id into v_id from public.movimientos m where m.idem_key = p_idem;
  return v_id;
end;
$$;

-- Inserta el movimiento con el motivo para la auditoría y devuelve su id (o el del movimiento
-- que ya tenía la misma clave).
create function public.insertar_movimiento(
  p_idem uuid,
  p_cuenta uuid,
  p_tipo text,
  p_importe bigint,
  p_fecha date,
  p_tramite uuid,
  p_revierte uuid,
  p_arancel bigint,
  p_prenda bigint,
  p_sellado bigint,
  p_otros bigint,
  p_es_final boolean,
  p_motivo text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);

  insert into public.movimientos (
    cuenta_id, tipo, importe_cents, fecha_operacion, tramite_id, revierte_id,
    arancel_cents, prenda_cents, sellado_cents, otros_cents, es_pago_final, motivo, creado_por, idem_key
  ) values (
    p_cuenta, p_tipo, p_importe, p_fecha, p_tramite, p_revierte,
    p_arancel, p_prenda, p_sellado, p_otros, p_es_final, p_motivo, auth.uid(), p_idem
  )
  on conflict (idem_key) do nothing
  returning id into v_id;

  if v_id is null then
    select m.id into v_id from public.movimientos m where m.idem_key = p_idem;
  end if;
  return v_id;
end;
$$;

-- Uso interno de las RPC de este archivo: no se exponen a los clientes.
revoke execute on function public.movimiento_por_idem(uuid) from public;
revoke execute on function public.insertar_movimiento(uuid, uuid, text, bigint, date, uuid, uuid, bigint, bigint, bigint, bigint, boolean, text) from public;

-- Bloquea la cuenta Habitualista de la empresa y devuelve su id.
create function public.bloquear_cuenta_empresa(p_empresa uuid) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_cuenta uuid;
begin
  select c.id into v_cuenta from public.cuentas c where c.empresa_id = p_empresa for update;
  if not found then
    raise exception 'NO_ENCONTRADO: la razón social no tiene cuenta Habitualista';
  end if;
  return v_cuenta;
end;
$$;

revoke execute on function public.bloquear_cuenta_empresa(uuid) from public;

-- Carga de fondos en la Habitualista de la empresa (gerencia o contable con alcance sobre
-- toda la razón social).
create function public.registrar_carga(
  p_idem uuid,
  p_empresa uuid,
  p_importe bigint,
  p_fecha date,
  p_motivo text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := public.movimiento_por_idem(p_idem);
  v_cuenta uuid;
begin
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance cargan fondos';
  end if;

  v_cuenta := public.bloquear_cuenta_empresa(p_empresa);
  v_id := public.movimiento_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

  if p_importe is null or p_importe <= 0 then
    raise exception 'DATO_INVALIDO: el importe de la carga debe ser mayor a cero';
  end if;
  if p_fecha is null then
    raise exception 'DATO_INVALIDO: la fecha de la carga es obligatoria';
  end if;

  return public.insertar_movimiento(
    p_idem, v_cuenta, 'carga', p_importe, p_fecha, null, null,
    null, null, null, null, false, nullif(btrim(p_motivo), ''));
end;
$$;

-- Pago real de un trámite. La cuenta se deriva del trámite (R23). Nunca se rechaza por
-- saldo (R21). La gestora asignada paga trámites autorizados y en curso; gerencia y contable
-- también en otros estados, con motivo de excepción (R24).
create function public.registrar_pago(
  p_idem uuid,
  p_tramite uuid,
  p_fecha date,
  p_arancel bigint,
  p_prenda bigint,
  p_sellado bigint,
  p_otros bigint,
  p_es_final boolean,
  p_motivo text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := public.movimiento_por_idem(p_idem);
  v_empresa uuid;
  v_cuenta uuid;
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
  v_motivo text := nullif(btrim(p_motivo), '');
  v_staff boolean;
  v_total numeric;
begin
  if v_id is not null then
    return v_id;
  end if;

  select t.empresa_id into v_empresa from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  -- La empresa de un trámite no cambia: la cuenta bloqueada sigue siendo la suya.
  v_cuenta := public.bloquear_cuenta_empresa(v_empresa);
  v_id := public.movimiento_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

  select t.* into v_t from public.tramites t where t.id = p_tramite for update;

  v_staff := coalesce(v_rol in ('gerencia', 'contable'), false)
             and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id);
  if not v_staff and not coalesce(v_rol = 'gestora' and v_t.gestora_id = auth.uid(), false) then
    raise exception 'SIN_PERMISO: no puede registrar pagos en este trámite';
  end if;

  if v_t.estado not in ('autorizado', 'en_gestoria', 'presentado', 'finalizado_registro') then
    if not v_staff then
      raise exception 'NO_AUTORIZADO: el trámite no está autorizado ni en curso (está %)', v_t.estado;
    end if;
    if v_motivo is null then
      raise exception 'NO_AUTORIZADO: pagar un trámite % requiere motivo de excepción', v_t.estado;
    end if;
  end if;

  if p_arancel is null or p_prenda is null or p_sellado is null or p_otros is null
     or least(p_arancel, p_prenda, p_sellado, p_otros) < 0 then
    raise exception 'DATO_INVALIDO: los conceptos del pago son obligatorios y no pueden ser negativos';
  end if;

  -- En numeric para que una suma desbordada sea un error de negocio y no de bigint.
  v_total := p_arancel::numeric + p_prenda + p_sellado + p_otros;
  if v_total <= 0 then
    raise exception 'DATO_INVALIDO: el total del pago debe ser mayor a cero';
  end if;
  if v_total > 9223372036854775807 then
    raise exception 'DATO_INVALIDO: el total del pago excede el máximo admitido';
  end if;

  if p_fecha is null then
    raise exception 'DATO_INVALIDO: la fecha del pago es obligatoria';
  end if;

  v_id := public.insertar_movimiento(
    p_idem, v_cuenta, 'pago_tramite', -v_total::bigint, p_fecha, p_tramite, null,
    p_arancel, p_prenda, p_sellado, p_otros, coalesce(p_es_final, false), v_motivo);

  -- El pago final cierra el compromiso del trámite (caso L). No es una edición del trámite:
  -- no incrementa tramites.version.
  if coalesce(p_es_final, false) then
    update public.tramites set pago_final_at = now() where id = p_tramite;
  end if;

  return v_id;
end;
$$;

-- Ajuste de saldo con signo (R26): solo gerencia con alcance, siempre con motivo.
create function public.registrar_ajuste(
  p_idem uuid,
  p_empresa uuid,
  p_importe bigint,
  p_fecha date,
  p_motivo text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := public.movimiento_por_idem(p_idem);
  v_cuenta uuid;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(public.mi_rol() = 'gerencia', false) is false
     or not public.tiene_alcance(p_empresa, null) then
    raise exception 'SIN_PERMISO: solo gerencia con alcance ajusta saldos';
  end if;

  v_cuenta := public.bloquear_cuenta_empresa(p_empresa);
  v_id := public.movimiento_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

  if p_importe is null or p_importe = 0 then
    raise exception 'DATO_INVALIDO: el importe del ajuste no puede ser cero';
  end if;
  if p_fecha is null then
    raise exception 'DATO_INVALIDO: la fecha del ajuste es obligatoria';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo del ajuste es obligatorio';
  end if;

  return public.insertar_movimiento(
    p_idem, v_cuenta, 'ajuste', p_importe, p_fecha, null, null,
    null, null, null, null, false, v_motivo);
end;
$$;

-- Reintegro de fondos de un trámite a su cuenta (caso F), con motivo.
create function public.registrar_reintegro(
  p_idem uuid,
  p_tramite uuid,
  p_importe bigint,
  p_fecha date,
  p_motivo text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := public.movimiento_por_idem(p_idem);
  v_empresa uuid;
  v_sucursal uuid;
  v_cuenta uuid;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_id is not null then
    return v_id;
  end if;

  select t.empresa_id, t.sucursal_id into v_empresa, v_sucursal from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_empresa, v_sucursal) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance registran reintegros';
  end if;

  v_cuenta := public.bloquear_cuenta_empresa(v_empresa);
  v_id := public.movimiento_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

  if p_importe is null or p_importe <= 0 then
    raise exception 'DATO_INVALIDO: el importe del reintegro debe ser mayor a cero';
  end if;
  if p_fecha is null then
    raise exception 'DATO_INVALIDO: la fecha del reintegro es obligatoria';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo del reintegro es obligatorio';
  end if;

  return public.insertar_movimiento(
    p_idem, v_cuenta, 'reintegro', p_importe, p_fecha, p_tramite, null,
    null, null, null, null, false, v_motivo);
end;
$$;

-- Revierte un movimiento (caso G): crea el inverso ligado por revierte_id, con el mismo
-- trámite, -importe y el desglose con signo invertido; el original no se toca. La reversión
-- lleva la fecha operativa del día en que se registra. Si el original era un pago final, el
-- trámite toma como pago final el último que siga vigente (o ninguno).
create function public.revertir_movimiento(p_idem uuid, p_movimiento uuid, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = public
set timezone = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_id uuid := public.movimiento_por_idem(p_idem);
  v_m public.movimientos%rowtype;
  v_empresa uuid;
  v_sucursal uuid;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_restriccion text;
begin
  if v_id is not null then
    return v_id;
  end if;

  select m.* into v_m from public.movimientos m where m.id = p_movimiento;
  if not found then
    raise exception 'NO_ENCONTRADO: movimiento inexistente';
  end if;

  if v_m.tramite_id is null then
    select c.empresa_id into v_empresa from public.cuentas c where c.id = v_m.cuenta_id;
  else
    select t.empresa_id, t.sucursal_id into v_empresa, v_sucursal from public.tramites t where t.id = v_m.tramite_id;
  end if;

  -- Sin sucursal (movimiento de cuenta) exige alcance sobre toda la razón social.
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_empresa, v_sucursal) then
    raise exception 'SIN_PERMISO: solo gerencia o contable con alcance revierten movimientos';
  end if;

  perform 1 from public.cuentas c where c.id = v_m.cuenta_id for update;
  v_id := public.movimiento_por_idem(p_idem);
  if v_id is not null then
    return v_id;
  end if;

  if v_m.tipo = 'reversion' then
    raise exception 'DATO_INVALIDO: una reversión no se revierte; registre un movimiento nuevo';
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: el motivo de la reversión es obligatorio';
  end if;

  if v_m.es_pago_final then
    perform 1 from public.tramites t where t.id = v_m.tramite_id for update;
  end if;

  begin
    v_id := public.insertar_movimiento(
      p_idem, v_m.cuenta_id, 'reversion', -v_m.importe_cents, current_date, v_m.tramite_id, v_m.id,
      -v_m.arancel_cents, -v_m.prenda_cents, -v_m.sellado_cents, -v_m.otros_cents, false, v_motivo);
  exception when unique_violation then
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion = 'movimientos_revierte_id_key' then
      raise exception 'DUPLICADO: el movimiento ya fue revertido';
    end if;
    raise;
  end;

  if v_m.es_pago_final then
    update public.tramites t
       set pago_final_at = (
             select max(m.created_at)
               from public.movimientos m
              where m.tramite_id = v_m.tramite_id
                and m.es_pago_final
                and not exists (select 1 from public.movimientos r where r.revierte_id = m.id))
     where t.id = v_m.tramite_id;
  end if;

  return v_id;
end;
$$;
