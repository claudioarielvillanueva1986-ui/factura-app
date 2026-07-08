-- ============================================================
-- facturá. — 013: Hardening post-auditoría
--
-- 1) Idempotencia de pagos de suscripción: Mercado Pago reintenta los
--    webhooks cuando no recibe un 200 a tiempo. Sin un único por
--    mp_payment_id se insertan filas duplicadas que ensucian el historial
--    y el panel admin.
--
-- 2) Lock de emisión ARCA: emitirFacturaARCA tardaba ~5-20s entre chequear
--    el estado y guardarlo; dos requests concurrentes (doble click, retry)
--    podían autorizar DOS comprobantes distintos en AFIP. Con esta columna
--    el claim se hace atómico (ver lib/arca.ts).
-- ============================================================

-- 1) Idempotencia de pagos de suscripción
create unique index if not exists pagos_suscripcion_mp_payment_uq
  on pagos_suscripcion (mp_payment_id)
  where mp_payment_id is not null;

-- 2) Lock de emisión ARCA (null = libre)
alter table facturas
  add column if not exists emision_lock_at timestamptz;
