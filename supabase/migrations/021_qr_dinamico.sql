-- ============================================================
-- facturá. — 021: QR dinámico real de Mercado Pago (no Checkout Pro)
--
-- El QR de Checkout Pro (metodo="qr") es un link web: si el cliente lo
-- escanea con el lector propio de la app de Mercado Pago (no con la
-- cámara), la app lo rechaza con "esto no es para hacer pagos", porque
-- espera el formato propio de QR de cobro en persona (Dynamic QR Model).
-- Este método agrega ese QR real, que sí reconoce el lector de la app.
--
-- Requiere que el negocio tenga una Tienda + Caja (Store + POS) dadas de
-- alta en su cuenta de MP — se crean automáticamente la primera vez que se
-- pide un cobro con metodo="qr_dinamico", usando la dirección cargada acá
-- (obligatoria para el alta de la Tienda en la API de MP).
--
-- La reconciliación del pago reusa el webhook de "payment" que ya existe:
-- MP emite ese evento para cualquier pago aprobado sea cual sea el canal
-- (QR, Point o Checkout Pro), y ya matchea por external_reference =
-- cobros.id. No hace falta un manejador nuevo para esto.
-- ============================================================

alter table mercadopago_config
  add column store_external_id text,
  add column pos_external_id text,
  add column domicilio_calle text,
  add column domicilio_numero text,
  add column domicilio_ciudad text,
  add column domicilio_provincia text;

-- El SELECT/UPDATE de authenticated es a nivel columna (ver 008_seguridad),
-- así que hay que habilitar explícitamente las columnas nuevas que sí carga
-- el negocio (la dirección). store_external_id/pos_external_id los escribe
-- únicamente el servidor (service_role), no se agregan a este grant.
grant select (domicilio_calle, domicilio_numero, domicilio_ciudad, domicilio_provincia),
      update (domicilio_calle, domicilio_numero, domicilio_ciudad, domicilio_provincia)
  on mercadopago_config to authenticated;

alter table cobros drop constraint if exists cobros_metodo_check;
alter table cobros add constraint cobros_metodo_check check (metodo in ('qr', 'point', 'qr_dinamico'));

alter table cobros
  add column merchant_order_id text,
  add column qr_data text;
create index cobros_merchant_order_idx on cobros (merchant_order_id) where merchant_order_id is not null;
