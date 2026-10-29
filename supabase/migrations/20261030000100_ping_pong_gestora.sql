-- Circuito "ping pong" empresa - gestora, nuevas razones sociales y ciudades de San Luis.
--
-- Circuito: la empresa autoriza y asigna la gestora -> la gestora presupuesta -> gerencia o
-- contable aprueba el presupuesto ("la plata está guardada") -> la gestora retira el legajo,
-- presenta, marca finalizado y devuelto -> la empresa cierra.
-- La aprobación es por versión: si la gestora cambia el presupuesto, hay que volver a aprobarlo.

-- Las razones sociales nuevas y las ciudades de San Luis están en 20261030000101_empresas_ciudades_catalogos.sql.

-- =====================================================================================
-- 2. Aprobación de presupuestos
-- =====================================================================================

create table public.aprobaciones_presupuesto (
  tramite_id uuid not null references public.tramites (id),
  version int not null,
  aprobado_por uuid not null references public.perfiles (id),
  at timestamptz not null default now(),
  primary key (tramite_id, version),
  foreign key (tramite_id, version) references public.presupuestos (tramite_id, version)
);

create trigger trg_auditar after insert or update or delete on public.aprobaciones_presupuesto
  for each row execute function public.auditar('tramite_id');

create trigger trg_inmutable before update or delete on public.aprobaciones_presupuesto
  for each row execute function public.impedir_modificacion();

alter table public.aprobaciones_presupuesto enable row level security;
revoke all on public.aprobaciones_presupuesto from public, anon, authenticated;
grant select on public.aprobaciones_presupuesto to authenticated;

create policy aprobaciones_presupuesto_select on public.aprobaciones_presupuesto for select to authenticated
  using (public.puede_ver_tramite(tramite_id));

-- true si la versión vigente del presupuesto del trámite está aprobada.
create function public.presupuesto_aprobado(p_tramite uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.aprobaciones_presupuesto a
     where a.tramite_id = p_tramite
       and a.version = (select max(p.version) from public.presupuestos p where p.tramite_id = p_tramite)
  )
$$;

revoke execute on function public.presupuesto_aprobado(uuid) from public, anon;
grant execute on function public.presupuesto_aprobado(uuid) to authenticated;

-- Gerencia o contable aprueba la versión vigente del presupuesto (p_version evita aprobar una
-- versión que la gestora ya cambió). No se aprueba un trámite sin fondos: primero hay que
-- cargar fondos o que gerencia apruebe la excepción.
create function public.aprobar_presupuesto(p_tramite uuid, p_version int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_vigente int;
  v_situacion text;
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id) then
    raise exception 'SIN_PERMISO: no puede aprobar presupuestos de este trámite';
  end if;
  if v_t.estado not in ('autorizado', 'en_gestoria') then
    raise exception 'TRANSICION_INVALIDA: solo se aprueba el presupuesto antes de presentar (está %)', v_t.estado;
  end if;

  select max(p.version) into v_vigente from public.presupuestos p where p.tramite_id = p_tramite;
  if v_vigente is null then
    raise exception 'NO_ENCONTRADO: el trámite todavía no tiene presupuesto';
  end if;
  if p_version is distinct from v_vigente then
    raise exception 'VERSION_CONFLICTO: la gestora cambió el presupuesto (versión vigente %)', v_vigente;
  end if;

  select f.situacion into v_situacion from public.v_tramite_finanzas_base f where f.tramite_id = p_tramite;
  if v_situacion = 'sin_fondos' then
    raise exception 'NO_AUTORIZADO: no hay fondos para este presupuesto; cargá fondos o aprobá la excepción';
  end if;

  perform set_config('app.motivo', '', true);
  insert into public.aprobaciones_presupuesto (tramite_id, version, aprobado_por)
  values (p_tramite, v_vigente, auth.uid())
  on conflict (tramite_id, version) do nothing;
end;
$$;

revoke execute on function public.aprobar_presupuesto(uuid, int) from public, anon;
grant execute on function public.aprobar_presupuesto(uuid, int) to authenticated;

-- =====================================================================================
-- 3. Transiciones de la gestora
-- =====================================================================================

-- La gestora además marca "devuelto" (devolvió la documentación a la empresa).
create or replace function public.transicion_permitida(
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
        ('presentado', 'finalizado_registro'),
        ('finalizado_registro', 'devuelto')
      )
    else false
  end, false)
$$;

-- La gestora solo presenta con el presupuesto vigente aprobado y el legajo retirado.
create function public.exigir_aprobacion_gestora() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.mi_rol() = 'gestora' and new.estado = 'presentado' and old.estado <> 'presentado' then
    if not public.presupuesto_aprobado(new.id) then
      raise exception 'NO_AUTORIZADO: el presupuesto todavía no fue aprobado por la empresa';
    end if;
    if not exists (select 1 from public.tramite_marcas m where m.tramite_id = new.id and m.marca = 'retirado') then
      raise exception 'DATO_INVALIDO: primero marcá que retiraste el legajo';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_exigir_aprobacion_gestora before update of estado on public.tramites
  for each row execute function public.exigir_aprobacion_gestora();

-- La gestora retira el legajo solo con el presupuesto aprobado.
create or replace function public.marcar(p_tramite uuid, p_marca text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
  v_es_empresa boolean;
begin
  if p_marca is null or p_marca not in ('legajo_recibido', 'firmado', 'entregado', 'retirado', 'recibido_admin') then
    raise exception 'DATO_INVALIDO: marca % inexistente', p_marca;
  end if;

  select t.* into v_t from public.tramites t where t.id = p_tramite;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;

  v_es_empresa := coalesce(v_rol in ('gerencia', 'contable'), false)
                  and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id);
  if not v_es_empresa
     and not (p_marca = 'retirado' and v_rol = 'gestora' and v_t.gestora_id = auth.uid()) then
    raise exception 'SIN_PERMISO: no puede registrar la marca % en este trámite', p_marca;
  end if;
  if not v_es_empresa and v_t.estado in ('autorizado', 'en_gestoria')
     and not public.presupuesto_aprobado(p_tramite) then
    raise exception 'NO_AUTORIZADO: esperá que la empresa apruebe el presupuesto antes de retirar el legajo';
  end if;

  perform set_config('app.motivo', '', true);

  insert into public.tramite_marcas (tramite_id, marca, por)
  values (p_tramite, p_marca, auth.uid())
  on conflict (tramite_id, marca) do nothing;
end;
$$;

-- =====================================================================================
-- 4. Lo que ve la gestora
-- =====================================================================================

-- Versión vigente y si está aprobada, para ambos lados del circuito (columnas agregadas al final).
create or replace view public.v_tramite_finanzas with (security_invoker = false) as
select f.tramite_id,
       f.empresa_id,
       f.presupuesto_cents,
       f.pagado_cents,
       f.comprometido_cents,
       f.desvio_cents,
       f.desvio_pct,
       f.situacion,
       (select max(p.version) from public.presupuestos p where p.tramite_id = f.tramite_id) as presupuesto_version,
       public.presupuesto_aprobado(f.tramite_id) as presupuesto_aprobado
  from public.v_tramite_finanzas_base f
 where public.puede_ver_tramite(f.tramite_id);

-- Plata de cada razón social con la que trabaja la gestora (alcances o trámites asignados):
-- disponible y apartado para trámites. Sin movimientos ni detalle contable.
create function public.saldos_gestora()
returns table (empresa_id uuid, empresa text, disponible_cents bigint, comprometido_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select s.empresa_id,
         e.nombre,
         (s.registrado_cents - coalesce(comp.c, 0))::bigint,
         coalesce(comp.c, 0)::bigint
    from public.v_saldo_registrado_base s
    join public.empresas e on e.id = s.empresa_id
    left join lateral (
      select sum(f.comprometido_cents) as c from public.v_tramite_finanzas_base f where f.cuenta_id = s.cuenta_id
    ) comp on true
   where public.mi_rol() = 'gestora'
     and (exists (select 1 from public.alcances a where a.perfil_id = auth.uid() and a.empresa_id = s.empresa_id)
          or exists (select 1 from public.tramites t
                      where t.gestora_id = auth.uid() and t.empresa_id = s.empresa_id
                        and t.estado not in ('borrador', 'observado', 'rechazado', 'cancelado', 'cerrado')))
   order by e.nombre
$$;

revoke execute on function public.saldos_gestora() from public, anon;
grant execute on function public.saldos_gestora() to authenticated;

-- =====================================================================================
-- 5. Avisos
-- =====================================================================================

alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('asignado', 'observado', 'sin_fondos', 'presupuesto_cargado', 'presupuesto_aprobado'));

create function public.notificar_aprobacion() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites;
begin
  select * into v_t from public.tramites where id = new.tramite_id;
  perform public.notificar(array[v_t.gestora_id], 'presupuesto_aprobado', v_t.id,
    format('Aprobaron el presupuesto de %s: ya podés retirar el legajo y presentar', v_t.numero));
  return null;
end;
$$;

create trigger trg_notificar after insert on public.aprobaciones_presupuesto
  for each row execute function public.notificar_aprobacion();

-- Funciones de trigger: nadie las llama directamente.
revoke execute on function public.exigir_aprobacion_gestora() from public, anon, authenticated;
revoke execute on function public.notificar_aprobacion() from public, anon, authenticated;
