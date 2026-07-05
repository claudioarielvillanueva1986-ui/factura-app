-- ============================================================
-- facturá. — 007: datos fiscales del negocio para el comprobante
-- (encabezado oficial: domicilio comercial, IIBB, inicio de actividades)
-- ============================================================

alter table negocios
  add column domicilio text,
  add column iibb text,
  add column inicio_actividades date;
