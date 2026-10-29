-- Tablero en una sola consulta: por razón social, los trámites en cada etapa del ping pong con
-- la gestoría, y la lista de trámites que requieren intervención (sin traer filas de más).
-- Respeta el alcance: sólo trámites que el usuario puede ver (puede_ver_tramite) y razones
-- sociales sobre las que tiene algún alcance.
-- p_corte: instante desde el cual un autorizado sin presentar se considera demorado (lo calcula
-- el front con días hábiles; la base no conoce feriados).

create function public.resumen_tablero(p_corte timestamptz)
returns table (
  empresa_id uuid,
  empresa text,
  abiertos int,
  por_aprobar int,
  listos int,
  presentados int,
  finalizados int,
  devueltos int,
  sin_fondos int,
  demorados int
)
language sql stable security definer
set search_path = public
as $$
  with vis as (
    select t.id, t.estado, t.autorizado_at, t.empresa_id, fb.situacion,
           (select max(p.version) from public.presupuestos p where p.tramite_id = t.id) as presupuesto_version,
           coalesce(public.presupuesto_aprobado(t.id), false) as aprobado
      from public.tramites t
      left join public.v_tramite_finanzas_base fb on fb.tramite_id = t.id
     where public.puede_ver_tramite(t.id)
  )
  select e.id, e.nombre,
         count(v.id) filter (where v.estado not in ('cerrado', 'cancelado', 'rechazado'))::int,
         count(v.id) filter (where v.estado in ('autorizado', 'en_gestoria') and v.presupuesto_version is not null and not v.aprobado)::int,
         count(v.id) filter (where v.estado in ('autorizado', 'en_gestoria') and v.aprobado)::int,
         count(v.id) filter (where v.estado = 'presentado')::int,
         count(v.id) filter (where v.estado = 'finalizado_registro')::int,
         count(v.id) filter (where v.estado = 'devuelto')::int,
         count(v.id) filter (where v.situacion = 'sin_fondos')::int,
         count(v.id) filter (where v.estado in ('autorizado', 'en_gestoria') and v.autorizado_at < p_corte)::int
    from public.empresas e
    left join vis v on v.empresa_id = e.id
   where exists (select 1 from public.alcances a join public.perfiles p on p.id = a.perfil_id and p.activo
                  where a.perfil_id = auth.uid() and a.empresa_id = e.id)
      or exists (select 1 from vis w where w.empresa_id = e.id)
   group by e.id, e.nombre
   order by e.nombre;
$$;

create function public.tramites_intervencion(p_corte timestamptz)
returns table (id uuid, numero text, cliente text, empresa text, motivos text[])
language sql stable security definer
set search_path = public
as $$
  select x.id, x.numero, x.cliente, x.empresa, x.motivos
    from (
      select t.id, t.numero, o.cliente_nombre as cliente, e.nombre as empresa,
             array_remove(array[
               case when t.estado = 'observado' then 'observado' end,
               case when t.estado in ('autorizado', 'en_gestoria')
                         and (select max(p.version) from public.presupuestos p where p.tramite_id = t.id) is not null
                         and not public.presupuesto_aprobado(t.id) then 'por_aprobar' end,
               case when fb.situacion = 'sin_fondos' then 'sin_fondos' end,
               case when t.estado in ('autorizado', 'en_gestoria') and t.autorizado_at < p_corte then 'demorado' end
             ], null) as motivos
        from public.tramites t
        join public.operaciones o on o.id = t.operacion_id
        join public.empresas e on e.id = t.empresa_id
        left join public.v_tramite_finanzas_base fb on fb.tramite_id = t.id
       where public.puede_ver_tramite(t.id)
         and t.estado not in ('cerrado', 'cancelado', 'rechazado')
    ) x
   where cardinality(x.motivos) > 0
   order by x.numero;
$$;

revoke all on function public.resumen_tablero(timestamptz) from public, anon;
revoke all on function public.tramites_intervencion(timestamptz) from public, anon;
grant execute on function public.resumen_tablero(timestamptz) to authenticated;
grant execute on function public.tramites_intervencion(timestamptz) to authenticated;
