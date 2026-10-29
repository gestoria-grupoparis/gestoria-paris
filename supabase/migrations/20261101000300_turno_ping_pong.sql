-- Ping pong: cada paso lo hace solo quien tiene el turno. Los pasos de la gestora (presentar,
-- finalizar en el registro, devolver la documentacion y deshacer esos mismos pasos) ya no los
-- puede hacer gerencia ni contable. La empresa conserva sus turnos: observar/rechazar, en_gestoria
-- (y volver a autorizado), cerrar y reabrir, suspender/reanudar y cancelar.

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
        ('en_gestoria', 'autorizado'),
        ('devuelto', 'cerrado'),
        ('cerrado', 'devuelto')
      )
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
        ('presentado', 'autorizado'),
        ('finalizado_registro', 'presentado'),
        ('devuelto', 'finalizado_registro')
      )
    else false
  end, false)
$$;
