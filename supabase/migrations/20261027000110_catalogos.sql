-- Catálogos iniciales obligatorios: razones sociales, sucursales y tipos de trámite.
-- Viven en una migración (y no en seed.sql) porque `supabase db push` no aplica el seed.
-- Idempotente: se puede volver a ejecutar sin duplicar filas.

insert into public.empresas (nombre) values
  ('Paris Autos'),
  ('Paris Cars'),
  ('Paris Motor')
on conflict (nombre) do nothing;

insert into public.sucursales (nombre, provincia) values
  ('San Luis', 'San Luis'),
  ('San Juan', 'San Juan')
on conflict (nombre, provincia) do nothing;

insert into public.tipos_tramite (codigo, nombre) values
  ('patentamiento_0km', 'Patentamiento 0 km'),
  ('transferencia_usado', 'Transferencia de usado'),
  ('transferencia_parte_pago', 'Transferencia de usado en parte de pago')
on conflict (codigo) do nothing;
