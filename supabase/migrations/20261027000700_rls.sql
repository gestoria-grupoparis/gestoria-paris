-- Grants y RLS (spec F). authenticated solo lee (filtrado por RLS) y ejecuta RPC; toda escritura
-- pasa por funciones SECURITY DEFINER. anon no tiene nada. Las vistas v_* son del dueño
-- (security_invoker = false) y filtran internamente; las RPC y las funciones de visibilidad son
-- SECURITY DEFINER, así que RLS no las afecta (el dueño no está sujeto a RLS sin FORCE).

-- =====================================================================================
-- 1. Tablas: sin privilegios directos salvo SELECT
-- =====================================================================================

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
-- Supabase otorga por defecto todo a anon/authenticated sobre objetos nuevos: se anula.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on
  public.empresas, public.sucursales, public.tipos_tramite,
  public.perfiles, public.alcances,
  public.operaciones, public.tramites, public.tramite_marcas, public.presupuestos,
  public.cuentas, public.movimientos, public.excepciones_fondos, public.eventos
  to authenticated;
grant select on public.v_tramite_finanzas, public.v_saldos to authenticated;
-- contadores_tramite, v_saldo_registrado_base y v_tramite_finanzas_base quedan sin acceso.

-- =====================================================================================
-- 2. RLS
-- =====================================================================================

alter table public.empresas enable row level security;
alter table public.sucursales enable row level security;
alter table public.tipos_tramite enable row level security;
alter table public.perfiles enable row level security;
alter table public.alcances enable row level security;
alter table public.contadores_tramite enable row level security;
alter table public.operaciones enable row level security;
alter table public.tramites enable row level security;
alter table public.tramite_marcas enable row level security;
alter table public.presupuestos enable row level security;
alter table public.cuentas enable row level security;
alter table public.movimientos enable row level security;
alter table public.excepciones_fondos enable row level security;
alter table public.eventos enable row level security;

-- Catálogos: legibles por cualquier usuario autenticado.
create policy catalogo_select on public.empresas for select to authenticated using (true);
create policy catalogo_select on public.sucursales for select to authenticated using (true);
create policy catalogo_select on public.tipos_tramite for select to authenticated using (true);

-- Perfiles y alcances: cada uno los suyos; gerencia, contable y admin, todos.
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = auth.uid() or public.mi_rol() in ('gerencia', 'contable', 'admin'));
create policy alcances_select on public.alcances for select to authenticated
  using (perfil_id = auth.uid() or public.mi_rol() in ('gerencia', 'contable', 'admin'));

-- Trámites y lo que cuelga de ellos: misma regla que puede_ver_tramite (gerencia/contable por
-- alcance; gestora asignada y fuera de borrador/observado/rechazado).
create policy tramites_select on public.tramites for select to authenticated
  using (public.puede_ver_tramite(id));
create policy tramite_marcas_select on public.tramite_marcas for select to authenticated
  using (public.puede_ver_tramite(tramite_id));
create policy presupuestos_select on public.presupuestos for select to authenticated
  using (public.puede_ver_tramite(tramite_id));
create policy operaciones_select on public.operaciones for select to authenticated
  using (
    case public.mi_rol()
      when 'gerencia' then public.tiene_alcance(empresa_id, sucursal_id)
      when 'contable' then public.tiene_alcance(empresa_id, sucursal_id)
      when 'gestora' then exists (select 1 from public.tramites t
                                   where t.operacion_id = operaciones.id
                                     and public.puede_ver_tramite(t.id))
      else false
    end
  );

-- Dinero: gerencia y contable por alcance de empresa; la gestora solo sus propios pagos.
create policy cuentas_select on public.cuentas for select to authenticated
  using (public.mi_rol() in ('gerencia', 'contable') and public.tiene_alcance(empresa_id, null));
create policy movimientos_select on public.movimientos for select to authenticated
  using (
    case public.mi_rol()
      when 'gerencia' then exists (select 1 from public.cuentas c
                                    where c.id = movimientos.cuenta_id
                                      and public.tiene_alcance(c.empresa_id, null))
      when 'contable' then exists (select 1 from public.cuentas c
                                    where c.id = movimientos.cuenta_id
                                      and public.tiene_alcance(c.empresa_id, null))
      when 'gestora' then creado_por = auth.uid()
      else false
    end
  );
create policy excepciones_fondos_select on public.excepciones_fondos for select to authenticated
  using (public.mi_rol() in ('gerencia', 'contable') and public.puede_ver_tramite(tramite_id));

-- Historial: gerencia y contable ven los eventos de las entidades que podrían ver (mismo
-- alcance que la tabla de origen, resuelto desde la foto antes/después); perfiles y alcances
-- quedan abiertos para ellos. La gestora, los eventos de los trámites que ve.
create policy eventos_select on public.eventos for select to authenticated
  using (
    case
      when public.mi_rol() in ('gerencia', 'contable') then
        case entidad
          when 'perfiles' then true
          when 'alcances' then true
          when 'tramites' then public.puede_ver_tramite(entidad_id)
          when 'tramite_marcas' then public.puede_ver_tramite(entidad_id)
          when 'excepciones_fondos' then public.puede_ver_tramite(entidad_id)
          when 'presupuestos' then public.puede_ver_tramite(
            (coalesce(despues, antes) ->> 'tramite_id')::uuid)
          when 'operaciones' then public.tiene_alcance(
            (coalesce(despues, antes) ->> 'empresa_id')::uuid,
            (coalesce(despues, antes) ->> 'sucursal_id')::uuid)
          when 'cuentas' then public.tiene_alcance(
            (coalesce(despues, antes) ->> 'empresa_id')::uuid, null)
          when 'movimientos' then exists (
            select 1 from public.cuentas c
             where c.id = (coalesce(eventos.despues, eventos.antes) ->> 'cuenta_id')::uuid
               and public.tiene_alcance(c.empresa_id, null))
          else false
        end
      else public.puede_ver_tramite(entidad_id)
    end
  );

-- Sin políticas INSERT/UPDATE/DELETE: authenticated no escribe tablas.

-- =====================================================================================
-- 3. Funciones: solo authenticated ejecuta RPC y helpers de visibilidad
-- =====================================================================================

revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         -- helpers usados por las políticas y la interfaz
         'mi_rol', 'tiene_alcance', 'puede_ver_tramite', 'transicion_permitida',
         -- RPC
         'crear_tramite', 'buscar_duplicados', 'autorizar_tramite', 'cambiar_estado',
         'reasignar_gestora', 'marcar', 'registrar_presupuesto', 'registrar_carga',
         'registrar_pago', 'registrar_reintegro', 'registrar_ajuste', 'revertir_movimiento',
         'aprobar_excepcion_fondos')
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
