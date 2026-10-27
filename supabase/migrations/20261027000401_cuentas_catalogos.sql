-- Cuentas Habitualista iniciales: una por razón social, con saldo inicial 0 al 2026-01-01
-- (gerencia lo ajusta después, R26). Vive en una migración *_catalogos.sql (y no en seed.sql)
-- porque `supabase db push` no aplica el seed y producción necesita las cuentas.
-- Idempotente: se puede volver a ejecutar sin duplicar filas.

insert into public.cuentas (empresa_id, nombre, saldo_inicial_cents, saldo_inicial_fecha)
select e.id, 'Habitualista ' || e.nombre, 0, date '2026-01-01'
  from public.empresas e
 where e.nombre in ('Paris Autos', 'Paris Cars', 'Paris Motor')
on conflict (empresa_id) do nothing;
