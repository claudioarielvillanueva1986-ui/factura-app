-- ============================================================
-- facturá. — 014: Rate limiting (ventana fija) sobre Postgres
--
-- Evita abuso/DoS y brute-force sin depender de un servicio externo: usa la
-- misma base de Supabase. El RPC hace un incremento atómico por clave (una
-- fila por clave; el ON CONFLICT serializa los requests concurrentes con el
-- lock de fila), reseteando la ventana cuando venció.
--
-- Solo la service_role (route handlers) puede ejecutarlo.
-- ============================================================

create table if not exists rate_limits (
  clave           text primary key,
  ventana_inicio  timestamptz not null,
  contador        int not null
);

alter table rate_limits enable row level security;
-- sin policies: solo service_role

-- Consume un "hit" de la clave. Devuelve si está permitido, el conteo actual,
-- el límite y cuándo se resetea la ventana.
create or replace function consumir_rate_limit(
  p_clave       text,
  p_limite      int,
  p_ventana_seg int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora    timestamptz := now();
  v_inicio   timestamptz;
  v_contador int;
begin
  insert into rate_limits (clave, ventana_inicio, contador)
  values (p_clave, v_ahora, 1)
  on conflict (clave) do update
    set contador = case
          when rate_limits.ventana_inicio < v_ahora - make_interval(secs => p_ventana_seg)
            then 1
          else rate_limits.contador + 1
        end,
        ventana_inicio = case
          when rate_limits.ventana_inicio < v_ahora - make_interval(secs => p_ventana_seg)
            then v_ahora
          else rate_limits.ventana_inicio
        end
  returning ventana_inicio, contador into v_inicio, v_contador;

  return jsonb_build_object(
    'permitido', v_contador <= p_limite,
    'contador',  v_contador,
    'limite',    p_limite,
    'reset_en',  v_inicio + make_interval(secs => p_ventana_seg)
  );
end;
$$;

revoke all on function consumir_rate_limit(text, int, int) from public;
revoke execute on function consumir_rate_limit(text, int, int) from anon, authenticated;
grant execute on function consumir_rate_limit(text, int, int) to service_role;
