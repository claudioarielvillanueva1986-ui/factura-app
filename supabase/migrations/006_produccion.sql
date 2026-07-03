-- ============================================================
-- facturá. — 006: onboarding de producción
--   - Mercado Pago via OAuth (tokens con refresh)
--   - ARCA por delegación de web service al CUIT de la plataforma
-- ============================================================

-- ---------- Mercado Pago OAuth ----------
alter table mercadopago_config
  add column refresh_token text,
  add column mp_user_id    text,
  add column public_key    text,
  add column expira_en     timestamptz;

-- El webhook de plataforma resuelve el negocio por el user_id de MP
create index mercadopago_config_mp_user_idx on mercadopago_config (mp_user_id);

-- ---------- ARCA: modo de conexión ----------
-- 'delegado' (default): el cliente delega el WS de Facturación Electrónica
--   al CUIT de facturá. en el Administrador de Relaciones de Clave Fiscal.
--   Se emite con el certificado de la plataforma y el CUIT del cliente.
-- 'certificado_propio': flujo CSR/certificado por negocio (avanzado).
alter table negocios
  add column arca_modo text not null default 'delegado'
    check (arca_modo in ('delegado', 'certificado_propio')),
  add column arca_verificado_en timestamptz;

-- Los negocios que ya cargaron certificado propio siguen en ese modo
update negocios n
set arca_modo = 'certificado_propio'
where exists (
  select 1 from arca_credenciales a
  where a.negocio_id = n.id and a.cert_pem is not null
);
