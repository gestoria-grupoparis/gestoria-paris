-- Razones sociales sin gestoría y ciudades de San Luis. Migración *_catalogos.sql: se vuelve a
-- ejecutar al recargar catálogos, así que es idempotente.


-- Doral y Paris Track operan pero no tienen gestoría: sin cuenta Habitualista.
insert into public.empresas (nombre) values
  ('Doral'),
  ('Paris Track')
on conflict (nombre) do nothing;

-- San Luis se divide por ciudad; San Juan es un solo concesionario.
-- Al recargar catálogos, 20261027000110 vuelve a insertar 'San Luis': si ya existe la capital,
-- esa fila nueva (sin uso) se borra en vez de renombrarse.
delete from public.sucursales s
 where s.nombre = 'San Luis' and s.provincia = 'San Luis'
   and exists (select 1 from public.sucursales c where c.nombre = 'San Luis Capital' and c.provincia = 'San Luis');
update public.sucursales set nombre = 'San Luis Capital'
 where nombre = 'San Luis' and provincia = 'San Luis';

insert into public.sucursales (nombre, provincia) values
  ('Villa Mercedes', 'San Luis'),
  ('Merlo', 'San Luis')
on conflict (nombre, provincia) do nothing;

