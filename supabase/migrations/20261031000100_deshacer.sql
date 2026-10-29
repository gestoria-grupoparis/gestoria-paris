-- Corregir errores de clic: volver un paso atrás en el estado y quitar marcas documentales.
-- Todo con motivo obligatorio y queda en el historial (eventos), nunca se borra en silencio.

-- =====================================================================================
-- 1. Retrocesos de estado
-- =====================================================================================

-- Un paso atrás del circuito. "cerrado -> devuelto" reabre un cierre hecho por error.
create function public.es_retroceso(p_desde text, p_hacia text) returns boolean
language sql immutable
set search_path = public
as $$
  select (p_desde, p_hacia) in (
    ('en_gestoria', 'autorizado'),
    ('presentado', 'autorizado'), ('presentado', 'en_gestoria'),
    ('finalizado_registro', 'presentado'),
    ('devuelto', 'finalizado_registro'),
    ('cerrado', 'devuelto')
  )
$$;

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
      or public.es_retroceso(p_desde, p_hacia)
      or (p_hacia in ('suspendido', 'cancelado')
          and p_desde not in ('cerrado', 'cancelado', 'rechazado', p_hacia))
      or (p_desde = 'suspendido'
          and p_hacia in ('borrador', 'observado', 'autorizado', 'en_gestoria', 'presentado',
                          'finalizado_registro', 'devuelto'))
    when p_rol = 'gestora' and p_es_gestora_asignada then
      (p_desde, p_hacia) in (
        ('autorizado', 'presentado'), ('en_gestoria', 'presentado'),
        ('presentado', 'finalizado_registro'),
        ('finalizado_registro', 'devuelto'),
        -- deshacer su propio último paso (el cierre es de la empresa)
        ('presentado', 'autorizado'),
        ('finalizado_registro', 'presentado'),
        ('devuelto', 'finalizado_registro')
      )
    else false
  end, false)
$$;

-- cambiar_estado guarda el motivo en app.motivo antes del update: un retroceso sin motivo no pasa.
create function public.exigir_motivo_retroceso() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.es_retroceso(old.estado, new.estado)
     and coalesce(nullif(btrim(current_setting('app.motivo', true)), ''), null) is null then
    raise exception 'DATO_INVALIDO: indicá el motivo para volver de % a %', old.estado, new.estado;
  end if;
  return new;
end;
$$;

create trigger trg_exigir_motivo_retroceso before update of estado on public.tramites
  for each row execute function public.exigir_motivo_retroceso();

revoke execute on function public.exigir_motivo_retroceso() from public, anon, authenticated;
revoke execute on function public.es_retroceso(text, text) from public, anon;
grant execute on function public.es_retroceso(text, text) to authenticated;

-- =====================================================================================
-- 2. Quitar marcas documentales
-- =====================================================================================

-- La empresa quita cualquier marca; la gestora solo "retirado" de su trámite y antes de presentar.
create function public.desmarcar(p_tramite uuid, p_marca text, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_rol text := public.mi_rol();
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;
  if not (coalesce(v_rol in ('gerencia', 'contable'), false) and public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id))
     and not (v_rol = 'gestora' and v_t.gestora_id = auth.uid() and p_marca = 'retirado'
              and v_t.estado in ('autorizado', 'en_gestoria')) then
    raise exception 'SIN_PERMISO: no puede quitar la marca % de este trámite', p_marca;
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: indicá por qué se quita la marca';
  end if;
  if not exists (select 1 from public.tramite_marcas m where m.tramite_id = p_tramite and m.marca = p_marca) then
    raise exception 'NO_ENCONTRADO: el trámite no tiene esa marca';
  end if;

  perform set_config('app.motivo', v_motivo, true);
  delete from public.tramite_marcas where tramite_id = p_tramite and marca = p_marca;
end;
$$;

revoke execute on function public.desmarcar(uuid, text, text) from public, anon;
grant execute on function public.desmarcar(uuid, text, text) to authenticated;

-- =====================================================================================
-- 3. Retirar una aprobación de presupuesto hecha por error
-- =====================================================================================

-- La aprobación deja de ser inmutable: se puede retirar (con motivo, queda en eventos) mientras
-- el trámite no se presentó. La gestora vuelve a "esperando aprobación".
drop trigger trg_inmutable on public.aprobaciones_presupuesto;

create function public.revocar_aprobacion(p_tramite uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tramites%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  select t.* into v_t from public.tramites t where t.id = p_tramite for update;
  if not found then
    raise exception 'NO_ENCONTRADO: trámite inexistente';
  end if;
  if coalesce(public.mi_rol() in ('gerencia', 'contable'), false) is false
     or not public.tiene_alcance(v_t.empresa_id, v_t.sucursal_id) then
    raise exception 'SIN_PERMISO: no puede retirar la aprobación de este trámite';
  end if;
  if v_t.estado not in ('autorizado', 'en_gestoria') then
    raise exception 'TRANSICION_INVALIDA: el trámite ya se presentó (está %); primero volvelo atrás', v_t.estado;
  end if;
  if v_motivo is null then
    raise exception 'DATO_INVALIDO: indicá por qué se retira la aprobación';
  end if;
  if not public.presupuesto_aprobado(p_tramite) then
    raise exception 'NO_ENCONTRADO: el presupuesto vigente no está aprobado';
  end if;

  perform set_config('app.motivo', v_motivo, true);
  delete from public.aprobaciones_presupuesto where tramite_id = p_tramite;
end;
$$;

revoke execute on function public.revocar_aprobacion(uuid, text) from public, anon;
grant execute on function public.revocar_aprobacion(uuid, text) to authenticated;
