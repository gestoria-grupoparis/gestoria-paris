-- Parametros iniciales del estimador. Fuente: docs/gestoria/01-investigacion-estimador.md.
-- Solo reglas verificadas; lo no verificado (sellos del acto, otras provincias) queda sin fila y el
-- estimado lo muestra como "sin dato". Montos fijos en centavos. Idempotente.

insert into public.parametros_estimador (clave, vehiculo, provincia, valor, vigencia_desde, fuente, verificado) values
  -- MRPA = 0,5 UVA (Res. MJ 308/2026), pero el valor en pesos no esta publicado: lo carga gerencia.
  ('mrpa_pesos', null, null, null, '2026-09-01',
   'A CONFIRMAR: valor en pesos no publicado; 0,5 UVA redondeado a $10 (Res. MJ 308/2026). Cargar desde un recibo', false),
  ('inscripcion_pct', null, null, 1, '2026-09-01', 'DNRPA Anexo I/II 1A (Res. MJ 412/2026); recibo real 01/07/2026', true),
  ('inscripcion_min_mrpa', 'auto', null, 52, '2026-09-01', 'DNRPA Anexo I 1A (Res. MJ 412/2026)', true),
  ('inscripcion_min_mrpa', 'moto', null, 21, '2026-09-01', 'DNRPA Anexo II 1A (Res. MJ 412/2026)', true),
  ('transferencia_pct', null, null, 1, '2026-09-01', 'DNRPA Anexo I/II 2A (Res. MJ 412/2026)', true),
  ('transferencia_min_mrpa', 'auto', null, 32, '2026-09-01', 'DNRPA Anexo I 2A (Res. MJ 412/2026)', true),
  ('transferencia_min_mrpa', 'moto', null, 15, '2026-09-01', 'DNRPA Anexo II 2A (Res. MJ 412/2026)', true),
  ('prenda_por_mil', null, null, 1, '2026-09-01', 'DNRPA Anexo I/II 3A (Res. MJ 412/2026); recibo real 01/07/2026', true),
  ('prenda_min_mrpa', 'auto', null, 12, '2026-09-01', 'DNRPA Anexo I 3A (Res. MJ 412/2026)', true),
  ('prenda_min_mrpa', 'moto', null, 5, '2026-09-01', 'DNRPA Anexo II 3A (Res. MJ 412/2026)', true),
  ('reventa_descuento_pct', null, null, 10, '2026-09-01', 'DNRPA Anexo I 2A, beneficio habitualista dentro de 90 dias', true),
  ('sellos_prenda_pct', null, 'San Luis', 1.2, '2026-01-01', 'Retencion DPIP real; Ley VIII-254/2025 (Impositiva 2026 San Luis)', true),
  ('sellos_prenda_min', null, 'San Luis', 78000, '2026-01-01', 'Ley VIII-254/2025 (Impositiva 2026 San Luis), minimo legal', true),
  ('honorarios', null, null, 3250000, '2026-09-01', 'Planilla de rendiciones de la gestora ($32.500 por tramite)', true)
on conflict do nothing;
