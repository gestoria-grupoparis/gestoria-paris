-- Estimador de costos por tramite (modulo interno: solo gerencia y contable con alcance).
-- Parametros versionados con fuente y vigencia; calculo en una funcion pura; cada estimado
-- guardado es una version nueva e inmutable. No crea movimientos ni toca saldos.

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

-- valor null = sin dato (p. ej. MRPA en pesos a confirmar): la regla que lo usa queda parcial.
create table public.parametros_estimador (
  id uuid primary key default gen_random_uuid(),
  clave text not null check (clave in (
    'mrpa_pesos', 'inscripcion_pct', 'inscripcion_min_mrpa', 'transferencia_pct', 'transferencia_min_mrpa',
    'prenda_por_mil', 'prenda_min_mrpa', 'reventa_descuento_pct', 'sellos_prenda_pct', 'sellos_prenda_min',
    'honorarios')),
  vehiculo text check (vehiculo in ('auto', 'moto')),
  provincia text,
  valor numeric check (valor is null or valor >= 0),
  vigencia_desde date not null,
  vigencia_hasta date,
  fuente text not null check (btrim(fuente) <> ''),
  verificado boolean not null default false,
  creado_por uuid references public.perfiles (id),
  created_at timestamptz not null default now(),
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

create unique index parametros_estimador_vigente_uq
  on public.parametros_estimador (clave, coalesce(vehiculo, ''), coalesce(provincia, ''), vigencia_desde);

create table public.estimados (
  id uuid primary key default gen_random_uuid(),
  tramite_id uuid not null references public.tramites (id),
  version int not null check (version >= 1),
  entrada jsonb not null,
  lineas jsonb not null,
  total_cents bigint not null check (total_cents >= 0),
  confianza text not null check (confianza in ('completo', 'parcial', 'sin_valor')),
  creado_por uuid not null references public.perfiles (id),
  created_at timestamptz not null default now(),
  unique (tramite_id, version)
);

create trigger trg_auditar after insert or update or delete on public.parametros_estimador
  for each row execute function public.auditar();
create trigger trg_auditar after insert or update or delete on public.estimados
  for each row execute function public.auditar();
create trigger trg_inmutable before update or delete on public.estimados
  for each row execute function public.impedir_modificacion();

-- =====================================================================================
-- 2. Calculo puro
-- =====================================================================================

create function public.es_interno() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.mi_rol() in ('gerencia', 'contable'), false)
$$;

-- Parametro vigente a la fecha. Busca primero el especifico (vehiculo/provincia) y despues el general.
create function public.parametro_estimador(p_clave text, p_vehiculo text, p_provincia text, p_fecha date)
returns public.parametros_estimador
language sql stable
set search_path = public
as $$
  select p.*
    from public.parametros_estimador p
   where p.clave = p_clave
     and (p.vehiculo is null or p.vehiculo = p_vehiculo)
     and (p.provincia is null or p.provincia = p_provincia)
     and p.vigencia_desde <= p_fecha
     and (p.vigencia_hasta is null or p.vigencia_hasta >= p_fecha)
   order by (p.vehiculo is not null) desc, (p.provincia is not null) desc, p.vigencia_desde desc
   limit 1
$$;

-- Devuelve {lineas, total_cents, confianza}. importe_cents null = sin dato (no se inventa).
-- p_destino: cliente | habitualista_08 (arancel 0) | reventa_90 (descuento habitualista).
create function public.calcular_estimado(
  p_tipo text, p_vehiculo text, p_provincia text, p_valor bigint, p_prenda bigint, p_destino text, p_fecha date
) returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_lineas jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_parcial boolean := false;
  v_mrpa public.parametros_estimador;
  v_pct public.parametros_estimador;
  v_min public.parametros_estimador;
  v_desc public.parametros_estimador;
  v_acto text;
  v_imp numeric;
  v_minimo numeric;
  v_regla text;
  v_fuente text;
  v_verif boolean;
  v_veh text := coalesce(p_vehiculo, 'auto');
begin
  v_acto := case p_tipo
              when 'patentamiento_0km' then 'inscripcion'
              when 'transferencia_usado' then 'transferencia'
              when 'transferencia_parte_pago' then 'transferencia'
            end;
  v_mrpa := public.parametro_estimador('mrpa_pesos', v_veh, p_provincia, p_fecha);

  -- Arancel DNRPA
  if v_acto is null then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', null, 'regla', 'tipo de tramite sin regla',
      'importe_cents', null, 'fuente', 'sin dato: se completa con lo que informe la gestora', 'verificado', false);
    v_parcial := true;
  elsif p_valor is null or p_valor <= 0 then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', null, 'regla', 'falta el valor de referencia',
      'importe_cents', null, 'fuente', 'sin dato', 'verificado', false);
  elsif v_acto = 'transferencia' and p_destino = 'habitualista_08' then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', p_valor::text,
      'regla', 'a favor del habitualista (Solicitud Tipo 08): arancel 0', 'importe_cents', '0',
      'fuente', 'DNRPA Anexo I cat. 7 (Res. MJ 412/2026)', 'verificado', true);
  else
    v_pct := public.parametro_estimador(v_acto || '_pct', v_veh, p_provincia, p_fecha);
    v_min := public.parametro_estimador(v_acto || '_min_mrpa', v_veh, p_provincia, p_fecha);
    v_imp := p_valor * v_pct.valor / 100;
    v_regla := trim(to_char(v_pct.valor, 'FM990D0###')) || ' % del valor';
    v_fuente := v_pct.fuente;
    v_verif := v_pct.verificado;
    if v_mrpa.valor is not null and v_min.valor is not null then
      v_minimo := v_min.valor * v_mrpa.valor;
      v_regla := v_regla || ', minimo ' || v_min.valor || ' MRPA';
      v_imp := greatest(v_imp, v_minimo);
      v_verif := v_verif and v_mrpa.verificado and v_min.verificado;
    else
      v_regla := v_regla || ' (minimo sin dato: MRPA a confirmar)';
      v_verif := false;
    end if;
    if v_acto = 'transferencia' and p_destino = 'reventa_90' then
      v_desc := public.parametro_estimador('reventa_descuento_pct', v_veh, p_provincia, p_fecha);
      v_imp := v_imp * (100 - v_desc.valor) / 100;
      v_regla := v_regla || ', -' || v_desc.valor || ' % reventa habitualista';
      v_verif := v_verif and v_desc.verificado;
    end if;
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', p_valor::text, 'regla', v_regla,
      'importe_cents', round(v_imp)::bigint::text, 'fuente', v_fuente, 'verificado', v_verif);
    v_total := v_total + round(v_imp)::bigint;
    v_parcial := v_parcial or not v_verif;
  end if;

  -- Prenda (arancel DNRPA y sellos provinciales)
  if coalesce(p_prenda, 0) > 0 then
    v_pct := public.parametro_estimador('prenda_por_mil', v_veh, p_provincia, p_fecha);
    v_min := public.parametro_estimador('prenda_min_mrpa', v_veh, p_provincia, p_fecha);
    v_imp := p_prenda * v_pct.valor / 1000;
    v_regla := v_pct.valor || ' por mil del monto';
    v_verif := v_pct.verificado;
    if v_mrpa.valor is not null and v_min.valor is not null then
      v_imp := greatest(v_imp, v_min.valor * v_mrpa.valor);
      v_regla := v_regla || ', minimo ' || v_min.valor || ' MRPA';
      v_verif := v_verif and v_mrpa.verificado and v_min.verificado;
    else
      v_regla := v_regla || ' (minimo sin dato: MRPA a confirmar)';
      v_verif := false;
    end if;
    v_lineas := v_lineas || jsonb_build_object('concepto', 'prenda', 'base_cents', p_prenda::text, 'regla', v_regla,
      'importe_cents', round(v_imp)::bigint::text, 'fuente', v_pct.fuente, 'verificado', v_verif);
    v_total := v_total + round(v_imp)::bigint;
    v_parcial := v_parcial or not v_verif;

    v_pct := public.parametro_estimador('sellos_prenda_pct', v_veh, p_provincia, p_fecha);
    if v_pct.id is null or v_pct.provincia is null then
      v_lineas := v_lineas || jsonb_build_object('concepto', 'sellos_prenda', 'base_cents', p_prenda::text,
        'regla', 'sin regla verificada para ' || coalesce(p_provincia, 'la provincia'), 'importe_cents', null,
        'fuente', 'sin dato: se completa con lo que informe la gestora', 'verificado', false);
      v_parcial := true;
    else
      v_min := public.parametro_estimador('sellos_prenda_min', v_veh, p_provincia, p_fecha);
      v_imp := greatest(p_prenda * v_pct.valor / 100, coalesce(v_min.valor, 0));
      v_lineas := v_lineas || jsonb_build_object('concepto', 'sellos_prenda', 'base_cents', p_prenda::text,
        'regla', trim(to_char(v_pct.valor, 'FM990D0###')) || ' % del monto' ||
                 coalesce(', minimo $' || trim(to_char(v_min.valor / 100, 'FM999G999G990')), ''),
        'importe_cents', round(v_imp)::bigint::text, 'fuente', v_pct.fuente,
        'verificado', v_pct.verificado and coalesce(v_min.verificado, true));
      v_total := v_total + round(v_imp)::bigint;
      v_parcial := v_parcial or not (v_pct.verificado and coalesce(v_min.verificado, true));
    end if;
  end if;

  -- Sellos del acto: hoy no hay regla verificada en ninguna provincia.
  v_lineas := v_lineas || jsonb_build_object('concepto', 'sellos_acto', 'base_cents', case when p_valor > 0 then p_valor::text end,
    'regla', 'sin regla verificada', 'importe_cents', null,
    'fuente', 'sin dato: se completa con lo que informe la gestora', 'verificado', false);
  v_parcial := true;

  -- Honorarios de la gestora
  v_pct := public.parametro_estimador('honorarios', v_veh, p_provincia, p_fecha);
  if v_pct.valor is null then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'honorarios', 'base_cents', null, 'regla', 'sin dato',
      'importe_cents', null, 'fuente', 'sin dato', 'verificado', false);
    v_parcial := true;
  else
    v_lineas := v_lineas || jsonb_build_object('concepto', 'honorarios', 'base_cents', null, 'regla', 'monto fijo por tramite',
      'importe_cents', round(v_pct.valor)::bigint::text, 'fuente', v_pct.fuente, 'verificado', v_pct.verificado);
    v_total := v_total + round(v_pct.valor)::bigint;
    v_parcial := v_parcial or not v_pct.verificado;
  end if;

  return jsonb_build_object(
    'lineas', v_lineas,
    'total_cents', v_total::text,
    'confianza', case when p_valor is null or p_valor <= 0 then 'sin_valor'
                      when v_parcial then 'parcial' else 'completo' end);
end;
$$;

-- =====================================================================================
-- 3. RPC
-- =====================================================================================

create function public.estimar_tramite(
  p_tramite uuid, p_valor bigint, p_prenda bigint, p_vehiculo text, p_destino text, p_provincia text default null
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
  if p_provincia is not null and p_provincia not in ('San Luis', 'San Juan', 'Mendoza', 'Córdoba') then
    raise exception 'DATO_INVALIDO: provincia no admitida';
  end if;
  if coalesce(p_valor, 0) < 0 or coalesce(p_prenda, 0) < 0 then
    raise exception 'DATO_INVALIDO: los importes no pueden ser negativos';
  end if;
  v_prov := coalesce(p_provincia, v_t.provincia);
  v_e := public.calcular_estimado(v_t.codigo, coalesce(p_vehiculo, 'auto'), v_prov, nullif(p_valor, 0), p_prenda,
                                  coalesce(p_destino, 'cliente'), current_date);
  insert into public.estimados (tramite_id, version, entrada, lineas, total_cents, confianza, creado_por)
  values (p_tramite,
          coalesce((select max(version) from public.estimados where tramite_id = p_tramite), 0) + 1,
          jsonb_build_object('valor_cents', p_valor::text, 'prenda_cents', p_prenda::text, 'vehiculo', coalesce(p_vehiculo, 'auto'),
                             'destino', coalesce(p_destino, 'cliente'), 'provincia', v_prov),
          v_e -> 'lineas', (v_e ->> 'total_cents')::bigint, v_e ->> 'confianza', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================================
-- 4. Grants y RLS
-- =====================================================================================

revoke all on public.parametros_estimador, public.estimados from public, anon, authenticated;
grant select on public.parametros_estimador, public.estimados to authenticated;
alter table public.parametros_estimador enable row level security;
alter table public.estimados enable row level security;

create policy parametros_estimador_select on public.parametros_estimador for select to authenticated
  using (public.es_interno());
create policy estimados_select on public.estimados for select to authenticated
  using (public.es_interno()
         and exists (select 1 from public.tramites t where t.id = tramite_id and public.tiene_alcance(t.empresa_id, null)));

revoke all on function public.es_interno(), public.parametro_estimador(text, text, text, date),
  public.calcular_estimado(text, text, text, bigint, bigint, text, date),
  public.estimar_tramite(uuid, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.es_interno(), public.estimar_tramite(uuid, bigint, bigint, text, text, text) to authenticated;
