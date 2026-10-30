-- Hallazgos de la revision del estimador (no edita migraciones anteriores).
-- 1. calcular_estimado: un parametro faltante o sin valor deja la linea "sin dato", fuera del total,
--    y la confianza en parcial; las verificaciones nulas cuentan como no verificadas; el total nunca es nulo.
-- 2. estimar_tramite: solo acepta la tabla de valuaciones completa y vigente a la fecha del estimado.
-- 3. importar_valuaciones: primeras tandas simultaneas sin error de unicidad.
-- 4. prevision_fondos: se documenta que los reintegros netean el gasto real.
-- 5. guardar_parametro_estimador: una vigencia cargada antes de otra posterior se cierra antes de esa.
-- 7. es_interno() sigue con execute para authenticated: lo usan las politicas RLS (se evaluan como el
--    usuario) de parametros_estimador, estimados y valuaciones; revocarlo romperia esas lecturas.

create or replace function public.calcular_estimado(
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
    if v_acto = 'transferencia' and p_destino = 'reventa_90' then
      v_desc := public.parametro_estimador('reventa_descuento_pct', v_veh, p_provincia, p_fecha);
    end if;
  end if;
  if v_acto is not null and coalesce(p_valor, 0) > 0 and not (v_acto = 'transferencia' and p_destino = 'habitualista_08')
     and (v_pct.valor is null or (v_acto = 'transferencia' and p_destino = 'reventa_90' and v_desc.valor is null)) then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', p_valor::text,
      'regla', 'parametro sin valor cargado', 'importe_cents', null, 'fuente', 'sin dato', 'verificado', false);
    v_parcial := true;
  elsif v_acto is not null and coalesce(p_valor, 0) > 0 and not (v_acto = 'transferencia' and p_destino = 'habitualista_08') then
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
      v_imp := v_imp * (100 - v_desc.valor) / 100;
      v_regla := v_regla || ', -' || v_desc.valor || ' % reventa habitualista';
      v_verif := v_verif and v_desc.verificado;
    end if;
    v_lineas := v_lineas || jsonb_build_object('concepto', 'arancel', 'base_cents', p_valor::text, 'regla', v_regla,
      'importe_cents', round(v_imp)::bigint::text, 'fuente', v_fuente, 'verificado', v_verif);
    v_verif := coalesce(v_verif, false);
    v_total := v_total + round(v_imp)::bigint;
    v_parcial := v_parcial or not v_verif;
  end if;

  -- Prenda (arancel DNRPA y sellos provinciales)
  if coalesce(p_prenda, 0) > 0 then
    v_pct := public.parametro_estimador('prenda_por_mil', v_veh, p_provincia, p_fecha);
    v_min := public.parametro_estimador('prenda_min_mrpa', v_veh, p_provincia, p_fecha);
   if v_pct.valor is null then
    v_lineas := v_lineas || jsonb_build_object('concepto', 'prenda', 'base_cents', p_prenda::text,
      'regla', 'parametro sin valor cargado', 'importe_cents', null, 'fuente', 'sin dato', 'verificado', false);
    v_parcial := true;
   else
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
      'importe_cents', round(v_imp)::bigint::text, 'fuente', v_pct.fuente, 'verificado', coalesce(v_verif, false));
    v_total := v_total + round(v_imp)::bigint;
    v_parcial := v_parcial or not coalesce(v_verif, false);
   end if;

    v_pct := public.parametro_estimador('sellos_prenda_pct', v_veh, p_provincia, p_fecha);
    if v_pct.id is null or v_pct.provincia is null or v_pct.valor is null then
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
        'verificado', coalesce(v_pct.verificado and coalesce(v_min.verificado, true), false));
      v_total := v_total + round(v_imp)::bigint;
      v_parcial := v_parcial or not coalesce(v_pct.verificado and coalesce(v_min.verificado, true), false);
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
      'importe_cents', round(v_pct.valor)::bigint::text, 'fuente', v_pct.fuente, 'verificado', coalesce(v_pct.verificado, false));
    v_total := v_total + round(v_pct.valor)::bigint;
    v_parcial := v_parcial or not coalesce(v_pct.verificado, false);
  end if;

  return jsonb_build_object(
    'lineas', v_lineas,
    'total_cents', coalesce(v_total, 0)::text,
    'confianza', case when p_valor is null or p_valor <= 0 then 'sin_valor'
                      when v_parcial then 'parcial' else 'completo' end);
end;
$$;


create or replace function public.estimar_tramite(
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
  if p_mtm is not null and p_tabla is distinct from public.tabla_valuaciones_vigente(current_date) then
    raise exception 'DATO_INVALIDO: la tabla de valuaciones elegida no es la vigente (o esta incompleta); busca el vehiculo de nuevo';
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


create or replace function public.importar_valuaciones(
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

  -- Dos primeras tandas a la vez: la segunda no choca con la unica; espera el lock y agrega.
  insert into public.valuaciones_tablas (disposicion, vigente_desde, fuente_url, importado_por)
  values (btrim(p_disposicion), p_vigente_desde, nullif(btrim(p_fuente_url), ''), auth.uid())
  on conflict (disposicion, vigente_desde) do nothing;
  select * into v_t from public.valuaciones_tablas
   where disposicion = btrim(p_disposicion) and vigente_desde = p_vigente_desde
   for update;
  if v_t.completa then
    raise exception 'DUPLICADO: esa tabla ya se importo completa; las tablas anteriores no se modifican';
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


create or replace function public.guardar_parametro_estimador(
  p_clave text, p_vehiculo text, p_provincia text, p_valor numeric, p_vigencia_desde date, p_fuente text, p_verificado boolean
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(public.mi_rol() = 'gerencia', false) is false then
    raise exception 'SIN_PERMISO: solo gerencia actualiza los parametros del estimador';
  end if;
  if nullif(btrim(p_fuente), '') is null then
    raise exception 'DATO_INVALIDO: indica la fuente del parametro';
  end if;
  if p_vigencia_desde is null then
    raise exception 'DATO_INVALIDO: la fecha de vigencia es obligatoria';
  end if;
  if p_valor is not null and p_valor < 0 then
    raise exception 'DATO_INVALIDO: el valor no puede ser negativo';
  end if;
  if p_clave not in (select distinct clave from public.parametros_estimador) then
    raise exception 'DATO_INVALIDO: parametro desconocido';
  end if;

  update public.parametros_estimador
     set vigencia_hasta = p_vigencia_desde - 1
   where clave = p_clave
     and vehiculo is not distinct from p_vehiculo
     and provincia is not distinct from p_provincia
     and vigencia_desde < p_vigencia_desde
     and (vigencia_hasta is null or vigencia_hasta >= p_vigencia_desde);

  begin
    -- Si ya hay una vigencia posterior, la nueva termina el dia previo a esa.
    insert into public.parametros_estimador (clave, vehiculo, provincia, valor, vigencia_desde, vigencia_hasta, fuente, verificado, creado_por)
    values (p_clave, p_vehiculo, p_provincia, p_valor, p_vigencia_desde,
            (select min(x.vigencia_desde) - 1 from public.parametros_estimador x
              where x.clave = p_clave and x.vehiculo is not distinct from p_vehiculo
                and x.provincia is not distinct from p_provincia and x.vigencia_desde > p_vigencia_desde),
            btrim(p_fuente), coalesce(p_verificado, false), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICADO: ya hay un valor de ese parametro con esa fecha de vigencia';
  end;
  return v_id;
end;
$$;


comment on function public.prevision_fondos(date, uuid) is
  'Gasto real semanal = pagos menos reintegros (los reintegros reducen el gasto real a proposito). '
  'Tramites con presupuesto van a la semana en curso; los que solo tienen estimado, a la siguiente.';
