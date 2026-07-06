-- ============================================================
-- facturá. — 008: hardening de seguridad (auditoría)
-- ============================================================

-- ---------- 1) Ocultar tokens de Mercado Pago del cliente ----------
-- access_token / refresh_token / webhook_secret nunca deben ser legibles
-- desde el browser. Se agregan columnas derivadas (generated, sin exponer
-- el valor real) para que la UI pueda mostrar el estado de conexión sin
-- necesitar leer el token.
alter table mercadopago_config
  add column conectado boolean generated always as (access_token is not null) stored,
  add column manual boolean generated always as (access_token is not null and refresh_token is null) stored;

revoke select on mercadopago_config from authenticated;
grant select (
  negocio_id, auto_facturar, mp_user_id, public_key, expira_en, updated_at, conectado, manual
) on mercadopago_config to authenticated;

-- Conectar/configurar Mercado Pago (incluido el flujo de token manual) es
-- una acción de configuración: solo el admin del negocio puede insertar o
-- actualizar esta fila. Antes cualquier usuario autenticado del negocio
-- podía escribir access_token directo vía supabase-js sin pasar por la UI.
drop policy if exists mercadopago_config_all on mercadopago_config;

create policy mercadopago_config_select on mercadopago_config
  for select to authenticated
  using (negocio_id = mi_negocio_id());

create policy mercadopago_config_insert on mercadopago_config
  for insert to authenticated
  with check (
    negocio_id = mi_negocio_id()
    and exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  );

create policy mercadopago_config_update on mercadopago_config
  for update to authenticated
  using (
    negocio_id = mi_negocio_id()
    and exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  )
  with check (negocio_id = mi_negocio_id());

-- ---------- 2) Evitar que un usuario se autoascienda de rol ----------
-- Solo 'nombre' es editable directamente por el propio usuario; 'rol' y
-- 'negocio_id' quedan fuera del alcance del cliente.
revoke update on usuarios from authenticated;
grant update (nombre) on usuarios to authenticated;

-- ---------- 3) Configuración del negocio: solo admin, columnas acotadas ----------
-- Antes cualquier operador podía tocar cualquier columna de su negocio
-- (incluyendo, a futuro, campos de facturación de la plataforma).
revoke update on negocios from authenticated;
grant update (
  nombre, cuit, razon_social, condicion_iva, punto_venta,
  domicilio, iibb, inicio_actividades, arca_modo
) on negocios to authenticated;

drop policy if exists negocios_update on negocios;
create policy negocios_update on negocios
  for update to authenticated
  using (
    id = mi_negocio_id()
    and exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  )
  with check (id = mi_negocio_id());

-- ---------- 4) Congelar facturas ya emitidas (comprobante fiscal) ----------
-- Una vez que una factura tiene CAE, nadie desde el cliente debería poder
-- alterar sus montos/números ni borrarla; solo se permite marcarla como
-- 'enviada' (envío por WhatsApp).
create or replace function proteger_factura_emitida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.cae is not null then
      raise exception 'No se puede eliminar una factura ya emitida (CAE %).', OLD.cae;
    end if;
    return OLD;
  end if;

  if OLD.cae is not null then
    if NEW.numero <> OLD.numero
       or NEW.tipo <> OLD.tipo
       or NEW.fecha <> OLD.fecha
       or NEW.subtotal <> OLD.subtotal
       or NEW.iva <> OLD.iva
       or NEW.total <> OLD.total
       or NEW.cae <> OLD.cae
       or coalesce(NEW.cae_vencimiento, 'epoch'::date) <> coalesce(OLD.cae_vencimiento, 'epoch'::date)
       or NEW.cliente_id is distinct from OLD.cliente_id
       or NEW.negocio_id <> OLD.negocio_id
       or NEW.origen <> OLD.origen
       or NEW.mp_payment_id is distinct from OLD.mp_payment_id
       or NEW.estado not in ('emitida', 'enviada')
    then
      raise exception
        'No se puede modificar una factura ya emitida (CAE %). Solo se permite marcarla como enviada.',
        OLD.cae;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_proteger_factura_emitida on facturas;
create trigger trg_proteger_factura_emitida
  before update or delete on facturas
  for each row execute function proteger_factura_emitida();

-- ---------- 5) Cerrar el acceso público a las RPCs (defensa en profundidad) ----------
-- Ya validan auth.uid() internamente, pero Supabase concede EXECUTE a `anon`
-- explícitamente al crear cada función (vía ALTER DEFAULT PRIVILEGES), no
-- solo a través de PUBLIC — hay que revocarlo del rol puntual también.
revoke execute on function mi_negocio_id() from public, anon;
revoke execute on function crear_negocio_inicial(text, text) from public, anon;
revoke execute on function resumen_dashboard() from public, anon;
revoke execute on function crear_factura(char, uuid, jsonb) from public, anon;

grant execute on function mi_negocio_id() to authenticated;
grant execute on function crear_negocio_inicial(text, text) to authenticated;
grant execute on function resumen_dashboard() to authenticated;
grant execute on function crear_factura(char, uuid, jsonb) to authenticated;
