-- ============================================================
-- facturá. — 015: Toggle de facturación de transferencias entrantes
--
-- auto_facturar factura cualquier pago aprobado. Pero un negocio puede recibir
-- transferencias que NO son ventas (un familiar, plata de otra cuenta propia)
-- y no querer facturarlas. Este toggle (apagado por default) controla si las
-- transferencias entrantes (operation_type money_transfer/account_fund) se
-- facturan aunque auto_facturar esté prendido. Las ventas (regular_payment,
-- pos_payment, QR/checkout) siguen dependiendo solo de auto_facturar.
-- ============================================================

alter table mercadopago_config
  add column if not exists facturar_transferencias boolean not null default false;

-- El SELECT/UPDATE de authenticated es a nivel columna (no lee tokens), así
-- que hay que habilitar explícitamente la nueva columna para el negocio.
grant select (facturar_transferencias), update (facturar_transferencias)
  on mercadopago_config to authenticated;
