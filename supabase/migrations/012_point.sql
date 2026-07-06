-- ============================================================
-- facturá. — 012: Cobros con terminal física Mercado Pago Point
--
-- Extiende la Partner API (010_partners.sql) para que un cobro también
-- pueda cobrarse pasando la tarjeta en una terminal Point del negocio
-- (Orders API, type=point), en vez de un link/QR de Checkout Pro.
-- ============================================================

alter table cobros
  add column metodo text not null default 'qr' check (metodo in ('qr', 'point')),
  add column mp_order_id text,
  add column terminal_id text;

create index cobros_mp_order_idx on cobros (mp_order_id) where mp_order_id is not null;
