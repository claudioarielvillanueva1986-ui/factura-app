-- ============================================================
-- facturá. — 002: RPC de onboarding
-- ============================================================

-- Crea el negocio inicial + la fila de usuario para auth.uid().
-- SECURITY DEFINER: corre con permisos del owner y saltea RLS, porque en el
-- momento del registro el usuario todavía no tiene fila en `usuarios` y las
-- policies le negarían el insert.
-- Idempotente: si el usuario ya tiene negocio, devuelve el existente.
create or replace function crear_negocio_inicial(
  nombre_negocio text,
  nombre_usuario text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_negocio_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select negocio_id into v_negocio_id from usuarios where id = v_uid;
  if v_negocio_id is not null then
    return v_negocio_id;
  end if;

  insert into negocios (nombre, plan, trial_hasta)
  values (nombre_negocio, 'trial', current_date + interval '7 days')
  returning id into v_negocio_id;

  insert into usuarios (id, negocio_id, nombre, rol)
  values (v_uid, v_negocio_id, nombre_usuario, 'admin');

  return v_negocio_id;
end;
$$;

revoke all on function crear_negocio_inicial(text, text) from public;
grant execute on function crear_negocio_inicial(text, text) to authenticated;
