-- Publica cambios de tramites, presupuestos y movimientos para Supabase Realtime
-- (la pantalla Trámites se suscribe a postgres_changes). Realtime aplica RLS del
-- suscriptor a cada evento, porque las tablas tienen RLS habilitado (migración 0700).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.tramites, public.presupuestos, public.movimientos;
