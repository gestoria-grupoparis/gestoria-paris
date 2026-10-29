-- Controles de la rendición (importes, autorizados, honorarios) y detección de comprobantes
-- duplicados. Solo leen: no modifican nada y nunca crean movimientos.
-- Los importes viajan en el jsonb como texto (centavos), para no perder precisión en el cliente.

-- Comprobantes de la rendición que repiten otro comprobante visible para quien consulta:
-- 'mismo_archivo' = misma huella SHA-256 y página; 'mismo_numero' = mismo tipo y número y el
-- mismo emisor (por CUIT o por nombre), con otro archivo.
create function public.comprobantes_duplicados(p_rendicion uuid)
returns table (comprobante_id uuid, motivo text, otro_id uuid, otra_rendicion uuid)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.puede_ver_rendicion(p_rendicion) then
    raise exception 'NO_ENCONTRADO: rendición inexistente';
  end if;

  return query
  select c.id, 'mismo_archivo'::text, o.id, o.rendicion_id
    from public.comprobantes c
    join public.comprobantes o
      on o.id <> c.id and o.archivo_sha256 = c.archivo_sha256 and o.pagina = c.pagina
   where c.rendicion_id = p_rendicion
     and c.archivo_sha256 is not null
     and public.puede_ver_rendicion(o.rendicion_id)
  union all
  select c.id, 'mismo_numero'::text, o.id, o.rendicion_id
    from public.comprobantes c
    join public.comprobantes o
      on o.id <> c.id and o.tipo = c.tipo and o.numero = c.numero
     and ((c.emisor_cuit is not null and o.emisor_cuit = c.emisor_cuit)
          or upper(coalesce(o.emisor, '')) = upper(coalesce(c.emisor, '')))
   where c.rendicion_id = p_rendicion
     and c.numero is not null
     and o.archivo_sha256 is distinct from c.archivo_sha256
     and public.puede_ver_rendicion(o.rendicion_id);
end;
$$;

create function public.controles_rendicion(p_rendicion uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_r public.rendiciones%rowtype;
  v_desde date;
  v_hasta date;
  v_filas jsonb;
  v_total bigint;
  v_filas_ok boolean;
  v_debitado bigint;
  v_sin_rendir jsonb;
  v_no_aut jsonb;
  v_cantidad int;
  v_facturado bigint;
  v_esperado bigint;
begin
  select r.* into v_r from public.rendiciones r where r.id = p_rendicion;
  if not found or not public.puede_ver_rendicion(p_rendicion) then
    raise exception 'NO_ENCONTRADO: rendición inexistente';
  end if;
  v_desde := v_r.periodo;
  v_hasta := (v_r.periodo + interval '1 month')::date;

  -- 1. Importes por fila: suma de comprobantes (sin facturas de honorarios) contra PAGO.
  select coalesce(jsonb_agg(jsonb_build_object(
           'fila_id', x.id, 'nombre', x.nombre,
           'pago_cents', x.pago_cents::text, 'comprobantes_cents', x.comp::text,
           'diferencia_cents', (x.comp - x.pago_cents)::text, 'ok', x.comp = x.pago_cents)
           order by x.orden), '[]'::jsonb),
         coalesce(sum(x.pago_cents), 0)::bigint,
         coalesce(bool_and(x.comp = x.pago_cents), true)
    into v_filas, v_total, v_filas_ok
    from (
      select f.id, f.nombre, f.orden, f.pago_cents,
             coalesce((select sum(c.total_cents) from public.comprobantes c
                        where c.fila_id = f.id
                          and c.tipo not in ('factura_honorarios', 'factura_electronica')), 0)::bigint as comp
        from public.rendicion_filas f
       where f.rendicion_id = p_rendicion
    ) x;

  -- Pagos de trámites del mes en la Habitualista de la empresa, sin los revertidos.
  with pagos as (
    select m.id, m.fecha_operacion, m.importe_cents, m.tramite_id
      from public.movimientos m
      join public.cuentas cu on cu.id = m.cuenta_id
     where cu.empresa_id = v_r.empresa_id
       and m.tipo = 'pago_tramite'
       and m.fecha_operacion >= v_desde and m.fecha_operacion < v_hasta
       and not exists (select 1 from public.movimientos rv where rv.revierte_id = m.id)
  )
  select coalesce(-sum(p.importe_cents), 0)::bigint,
         coalesce(jsonb_agg(jsonb_build_object(
             'movimiento_id', p.id, 'fecha', p.fecha_operacion,
             'importe_cents', (-p.importe_cents)::text, 'tramite_id', p.tramite_id, 'tramite_numero', t.numero)
             order by p.fecha_operacion, t.numero)
           filter (where not exists (select 1 from public.rendicion_filas f
                                      where f.rendicion_id = p_rendicion and f.tramite_id = p.tramite_id)),
           '[]'::jsonb)
    into v_debitado, v_sin_rendir
    from pagos p
    left join public.tramites t on t.id = p.tramite_id;

  -- 2. Autorizados.
  select coalesce(jsonb_agg(jsonb_build_object('fila_id', y.id, 'nombre', y.nombre, 'motivo', y.motivo) order by y.orden), '[]'::jsonb)
    into v_no_aut
    from (
      select f.id, f.nombre, f.orden,
             case
               when f.tramite_id is null and f.vinculo = 'ambiguo' then 'ambiguo'
               when f.tramite_id is null then 'sin_vincular'
               when t.autorizado_at is null or t.estado in ('cancelado', 'rechazado') then 'no_autorizado'
             end as motivo
        from public.rendicion_filas f
        left join public.tramites t on t.id = f.tramite_id
       where f.rendicion_id = p_rendicion
    ) y
   where y.motivo is not null;

  -- 3. Honorarios: cantidad de filas por el unitario contra las facturas confirmadas.
  select count(*)::int into v_cantidad from public.rendicion_filas f where f.rendicion_id = p_rendicion;
  select coalesce(sum(c.total_cents), 0)::bigint into v_facturado
    from public.comprobantes c
   where c.rendicion_id = p_rendicion
     and c.tipo in ('factura_honorarios', 'factura_electronica')
     and c.revision = 'confirmado';
  v_esperado := v_cantidad * v_r.honorario_unitario_cents;

  return jsonb_build_object(
    'importes', jsonb_build_object(
      'filas', v_filas,
      'total_planilla_cents', v_total::text,
      'debitado_habitualista_cents', v_debitado::text,
      'diferencia_cents', (v_total - v_debitado)::text,
      'movimientos_sin_rendir', v_sin_rendir,
      'ok', v_filas_ok and v_total = v_debitado),
    'autorizados', jsonb_build_object(
      'filas_no_autorizadas', v_no_aut,
      'ok', jsonb_array_length(v_no_aut) = 0),
    'honorarios', jsonb_build_object(
      'cantidad_tramites', v_cantidad,
      'honorario_unitario_cents', v_r.honorario_unitario_cents::text,
      'esperado_cents', v_esperado::text,
      'facturado_cents', v_facturado::text,
      'diferencia_cents', (v_facturado - v_esperado)::text,
      'ok', v_facturado = v_esperado)
  );
end;
$$;

revoke all on function public.comprobantes_duplicados(uuid), public.controles_rendicion(uuid) from public, anon;
grant execute on function public.comprobantes_duplicados(uuid), public.controles_rendicion(uuid) to authenticated;
