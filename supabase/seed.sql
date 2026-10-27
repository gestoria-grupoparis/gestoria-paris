-- Datos iniciales: razones sociales, sucursales y tipos de trámite.
insert into public.empresas (nombre) values
  ('Paris Autos'),
  ('Paris Cars'),
  ('Paris Motor');

insert into public.sucursales (nombre, provincia) values
  ('San Luis', 'San Luis'),
  ('San Juan', 'San Juan');

insert into public.tipos_tramite (codigo, nombre) values
  ('patentamiento_0km', 'Patentamiento 0 km'),
  ('transferencia_usado', 'Transferencia de usado'),
  ('transferencia_parte_pago', 'Transferencia de usado en parte de pago');
