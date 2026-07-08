-- ============================================================
-- facturá. — 016: Polling de pagos MP (red de seguridad)
--
-- El webhook solo cubre lo que se genera desde facturá. Los cobros por
-- terminal Point standalone, QR nativo de la app de MP, links, etc. entran a
-- la cuenta del negocio sin que MP nos notifique. Este polling recorre
-- periódicamente los pagos aprobados de cada negocio y factura los que falten,
-- reutilizando el mismo flujo que el webhook (procesarEventoMP).
-- ============================================================

-- Marca de la última corrida exitosa por negocio (ventana de búsqueda).
alter table mercadopago_config
  add column if not exists ultimo_polling_en timestamptz;

-- Log por corrida y negocio (diagnóstico), estilo mp_webhook_logs.
create table if not exists mp_polling_logs (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid references negocios (id) on delete set null,
  desde        timestamptz,
  hasta        timestamptz,
  pagos_nuevos int not null default 0,   -- aprobados sin factura previa hallados
  procesados   int not null default 0,   -- entregados a procesarEventoMP
  capado       boolean not null default false, -- true si quedaron más para la próxima corrida
  resultado    text,
  error        text,
  created_at   timestamptz not null default now()
);

create index mp_polling_logs_negocio_idx on mp_polling_logs (negocio_id, created_at desc);

alter table mp_polling_logs enable row level security;
-- sin policies: solo service_role
