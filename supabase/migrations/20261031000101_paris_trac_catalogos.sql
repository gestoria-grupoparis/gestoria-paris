-- El nombre correcto es "Paris Trac". Catálogo idempotente: al recargar catálogos,
-- 20261030000101 vuelve a insertar "Paris Track" y acá se corrige o se descarta.
delete from public.empresas e
 where e.nombre = 'Paris Track'
   and exists (select 1 from public.empresas c where c.nombre = 'Paris Trac');
update public.empresas set nombre = 'Paris Trac' where nombre = 'Paris Track';
