-- ============================================================
-- facturá. — 001: schema inicial
-- Multi-tenant por negocio_id con RLS en todas las tablas.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type condicion_iva_negocio as enum ('monotributo', 'responsable_inscripto');
create type rol_usuario as enum ('admin', 'operador');
create type estado_factura as enum ('borrador', 'emitida', 'enviada', 'error');

-- ---------- negocios ----------
create table negocios (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  cuit          text,
  razon_social  text,
  condicion_iva condicion_iva_negocio not null default 'monotributo',
  punto_venta   int not null default 1,
  plan          text not null default 'trial',
  trial_hasta   date,
  created_at    timestamptz not null default now()
);

-- ---------- usuarios (1:1 con auth.users) ----------
create table usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  negocio_id uuid not null references negocios (id) on delete cascade,
  nombre     text not null,
  rol        rol_usuario not null default 'admin',
  created_at timestamptz not null default now()
);

create index usuarios_negocio_idx on usuarios (negocio_id);

-- ---------- clientes ----------
create table clientes (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references negocios (id) on delete cascade,
  nombre        text not null,
  cuit_dni      text,
  email         text,
  telefono      text,
  condicion_iva text not null default 'consumidor_final',
  created_at    timestamptz not null default now()
);

create index clientes_negocio_idx on clientes (negocio_id);

-- ---------- facturas ----------
create table facturas (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocios (id) on delete cascade,
  cliente_id      uuid references clientes (id) on delete set null,
  numero          int not null,
  tipo            char(1) not null check (tipo in ('A', 'B', 'C')),
  fecha           date not null default current_date,
  cae             text,
  cae_vencimiento date,
  subtotal        numeric(14, 2) not null default 0,
  iva             numeric(14, 2) not null default 0,
  total           numeric(14, 2) not null default 0,
  estado          estado_factura not null default 'borrador',
  origen          text not null default 'manual',
  mp_payment_id   text,
  wa_enviado      boolean not null default false,
  error_mensaje   text,
  created_at      timestamptz not null default now()
);

create index facturas_negocio_idx on facturas (negocio_id);
create index facturas_negocio_fecha_idx on facturas (negocio_id, fecha desc);
create unique index facturas_numero_unico
  on facturas (negocio_id, tipo, numero);
create unique index facturas_mp_payment_unico
  on facturas (negocio_id, mp_payment_id)
  where mp_payment_id is not null;

-- ---------- factura_items ----------
create table factura_items (
  id              uuid primary key default gen_random_uuid(),
  factura_id      uuid not null references facturas (id) on delete cascade,
  descripcion     text not null,
  cantidad        numeric(12, 2) not null default 1,
  precio_unitario numeric(14, 2) not null default 0,
  subtotal        numeric(14, 2) not null default 0
);

create index factura_items_factura_idx on factura_items (factura_id);

-- ---------- arca_credenciales ----------
-- Separada por seguridad: clave privada + certificado X.509 de ARCA/AFIP.
-- Solo accesible con service_role desde Netlify Functions. Sin políticas de
-- cliente: RLS habilitado sin policies = ningún acceso con anon/authenticated.
create table arca_credenciales (
  negocio_id uuid primary key references negocios (id) on delete cascade,
  key_pem    text,
  cert_pem   text,
  updated_at timestamptz not null default now()
);

-- ---------- mercadopago_config ----------
create table mercadopago_config (
  negocio_id     uuid primary key references negocios (id) on delete cascade,
  access_token   text,
  auto_facturar  boolean not null default false,
  webhook_secret text,
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================

-- Helper: negocio del usuario autenticado. SECURITY DEFINER para no recursar
-- sobre las policies de `usuarios`.
create or replace function mi_negocio_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select negocio_id from usuarios where id = auth.uid()
$$;

alter table negocios          enable row level security;
alter table usuarios          enable row level security;
alter table clientes          enable row level security;
alter table facturas          enable row level security;
alter table factura_items     enable row level security;
alter table arca_credenciales enable row level security;
alter table mercadopago_config enable row level security;

-- negocios: el usuario ve y edita solo su negocio
create policy negocios_select on negocios
  for select to authenticated
  using (id = mi_negocio_id());

create policy negocios_update on negocios
  for update to authenticated
  using (id = mi_negocio_id())
  with check (id = mi_negocio_id());

-- usuarios: ve los usuarios de su negocio; edita solo su propia fila
create policy usuarios_select on usuarios
  for select to authenticated
  using (negocio_id = mi_negocio_id());

create policy usuarios_update on usuarios
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and negocio_id = mi_negocio_id());

-- clientes
create policy clientes_all on clientes
  for all to authenticated
  using (negocio_id = mi_negocio_id())
  with check (negocio_id = mi_negocio_id());

-- facturas
create policy facturas_all on facturas
  for all to authenticated
  using (negocio_id = mi_negocio_id())
  with check (negocio_id = mi_negocio_id());

-- factura_items: a través de la factura padre
create policy factura_items_all on factura_items
  for all to authenticated
  using (
    exists (
      select 1 from facturas f
      where f.id = factura_id and f.negocio_id = mi_negocio_id()
    )
  )
  with check (
    exists (
      select 1 from facturas f
      where f.id = factura_id and f.negocio_id = mi_negocio_id()
    )
  );

-- arca_credenciales: SIN políticas para authenticated/anon.
-- RLS habilitado sin policies => solo service_role (que saltea RLS) accede.

-- mercadopago_config: solo el propio negocio
create policy mercadopago_config_all on mercadopago_config
  for all to authenticated
  using (negocio_id = mi_negocio_id())
  with check (negocio_id = mi_negocio_id());
