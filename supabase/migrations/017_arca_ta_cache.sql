-- ============================================================
-- facturá. — 017: Cache del Ticket de Acceso (TA) de WSAA/ARCA
--
-- ARCA (WSAA) entrega UN solo TA válido por certificado + servicio cada ~12 h
-- y rechaza pedir otro mientras haya uno vigente ("ya posee un TA valido").
-- afip.ts cachea el TA en /tmp, pero en serverless (Netlify Functions) ese
-- filesystem no se comparte entre invocaciones, así que cada emisión pide un
-- TA nuevo y colisiona. Guardamos el TA acá para reusarlo entre todas las
-- invocaciones/negocios (el TA es del certificado de la plataforma, sirve para
-- cualquier CUIT representado).
-- ============================================================

create table if not exists arca_ta_cache (
  produccion boolean primary key,          -- separa TA de producción vs homologación
  ta_json    jsonb not null,               -- { header, credentials } tal como lo serializa afip.ts
  expira_en  timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table arca_ta_cache enable row level security;
-- sin policies: solo service_role (lo usan las route handlers del servidor)
