-- ============================================================
-- facturá. — 010: Partner API (ecosistema soft-a-soft)
--
-- Permite que aplicaciones externas propias (ej: Soporte Móvil) actúen en
-- nombre de un negocio de facturá.: emitir facturas en ARCA y crear cobros
-- de Mercado Pago, sin manejar certificados ni tokens sensibles.
--
-- Modelo: OAuth authorization-code. El taller entra desde la app externa,
-- inicia sesión / se registra EN facturá. (exposición de marca), autoriza
-- los permisos (scopes) y la app externa recibe un access_token + refresh.
--
-- Seguridad: todas estas tablas tienen RLS habilitado SIN políticas => solo
-- la service_role (las route handlers del servidor) las lee/escribe. Los
-- tokens se guardan solo como hash SHA-256 (el valor en claro se muestra una
-- única vez). Mismo criterio que arca_credenciales / mp_webhook_logs.
-- ============================================================

-- ---------- Aplicaciones partner registradas ----------
-- Una fila por producto del ecosistema (Soporte Móvil, etc.). El
-- client_secret se genera una vez y se guarda hasheado.
create table partner_apps (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  client_id          text not null unique,
  client_secret_hash text not null,
  redirect_uris      text[] not null default '{}',
  scopes             text[] not null default '{lectura,facturacion,cobros}',
  webhook_url        text,
  webhook_secret     text,
  activo             boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table partner_apps enable row level security;
-- sin policies: solo service_role

-- ---------- Códigos de autorización (efímeros, PKCE opcional) ----------
create table partner_authorization_codes (
  code_hash      text primary key,
  app_id         uuid not null references partner_apps (id) on delete cascade,
  negocio_id     uuid not null references negocios (id) on delete cascade,
  usuario_id     uuid references auth.users (id) on delete set null,
  redirect_uri   text not null,
  scopes         text[] not null default '{}',
  code_challenge text,
  expira_en      timestamptz not null,
  usado          boolean not null default false,
  created_at     timestamptz not null default now()
);

create index partner_auth_codes_expira_idx on partner_authorization_codes (expira_en);

alter table partner_authorization_codes enable row level security;
-- sin policies: solo service_role

-- ---------- Grants: vínculo app externa <-> negocio ----------
-- access_token de vida corta (~1 h) + refresh_token de vida larga (rota).
create table partner_grants (
  id                 uuid primary key default gen_random_uuid(),
  app_id             uuid not null references partner_apps (id) on delete cascade,
  negocio_id         uuid not null references negocios (id) on delete cascade,
  access_token_hash  text unique,
  refresh_token_hash text unique,
  scopes             text[] not null default '{}',
  expira_en          timestamptz,        -- vencimiento del access_token
  revocado           boolean not null default false,
  ultimo_uso_en      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index partner_grants_app_negocio_idx on partner_grants (app_id, negocio_id);

alter table partner_grants enable row level security;
-- sin policies: solo service_role

-- ---------- Cobros creados vía Partner API (o por facturá. a futuro) ----------
-- Un cobro es una intención de pago de Mercado Pago (preferencia / link / QR)
-- que la app externa dispara. Al aprobarse el pago (webhook), se marca y —si
-- se pidió— se emite la factura y se notifica al webhook del partner.
create table cobros (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references negocios (id) on delete cascade,
  app_id             uuid references partner_apps (id) on delete set null,
  external_reference text,               -- id propio del partner (ej: venta de Soporte Móvil)
  monto              numeric(14,2) not null,
  descripcion        text,
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente','aprobado','rechazado','cancelado','expirado')),
  facturar           boolean not null default true,
  mp_preference_id   text,
  mp_payment_id      text,
  init_point         text,
  factura_id         uuid references facturas (id) on delete set null,
  notificado_en      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index cobros_negocio_idx on cobros (negocio_id, created_at desc);
create index cobros_mp_payment_idx on cobros (mp_payment_id) where mp_payment_id is not null;
-- Idempotencia por referencia externa del partner (por negocio)
create unique index cobros_ext_ref_unico
  on cobros (negocio_id, app_id, external_reference)
  where external_reference is not null;

alter table cobros enable row level security;
-- El negocio puede LEER sus cobros desde el panel (no escribirlos)
create policy cobros_select_propio on cobros
  for select to authenticated
  using (negocio_id = mi_negocio_id());
-- insert/update: solo service_role (Partner API + webhook)

-- ============================================================
-- RPC: crear_factura_partner
-- Igual que crear_factura pero para contexto service_role (sin auth.uid()):
-- recibe negocio_id explícito y un receptor opcional (find-or-create por
-- documento). Respeta el gate de suscripción y la numeración serializada.
-- p_receptor: { doc_tipo, doc_nro, nombre, condicion_iva, email, telefono } | null
-- p_items:    [{ descripcion, cantidad, precio_unitario }]
-- p_tipo:     'A'|'B'|'C' | null (auto: C monotributo, B responsable inscripto)
-- ============================================================
create or replace function crear_factura_partner(
  p_negocio_id uuid,
  p_receptor   jsonb,
  p_items      jsonb,
  p_tipo       char default null,
  p_origen     text default 'partner'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_condicion  condicion_iva_negocio;
  v_tipo       char(1);
  v_numero     int;
  v_subtotal   numeric(14,2) := 0;
  v_iva        numeric(14,2) := 0;
  v_total      numeric(14,2) := 0;
  v_factura    facturas%rowtype;
  v_item       jsonb;
  v_item_sub   numeric(14,2);
  v_cliente_id uuid;
  v_doc        text;
  v_nombre     text;
begin
  select condicion_iva into v_condicion from negocios where id = p_negocio_id;
  if v_condicion is null then
    raise exception 'Negocio inexistente';
  end if;

  if not cuenta_habilitada_para_facturar(p_negocio_id) then
    raise exception 'La cuenta no está habilitada para emitir facturas (trial/suscripción vencidos).';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura necesita al menos un ítem';
  end if;

  -- Tipo: explícito o automático según condición del emisor
  v_tipo := coalesce(p_tipo, case when v_condicion = 'monotributo' then 'C' else 'B' end);
  if v_tipo not in ('A','B','C') then
    raise exception 'Tipo de comprobante inválido: %', v_tipo;
  end if;
  if v_condicion = 'monotributo' and v_tipo <> 'C' then
    raise exception 'Un monotributista solo puede emitir facturas C';
  end if;

  -- Receptor: find-or-create por documento dentro del negocio
  if p_receptor is not null and coalesce(p_receptor->>'doc_nro','') <> '' then
    v_doc := p_receptor->>'doc_nro';
    v_nombre := coalesce(nullif(p_receptor->>'nombre',''), 'Consumidor Final');
    select id into v_cliente_id
    from clientes
    where negocio_id = p_negocio_id and cuit_dni = v_doc
    limit 1;
    if v_cliente_id is null then
      insert into clientes (negocio_id, nombre, cuit_dni, email, telefono, condicion_iva)
      values (
        p_negocio_id, v_nombre, v_doc,
        nullif(p_receptor->>'email',''), nullif(p_receptor->>'telefono',''),
        coalesce(nullif(p_receptor->>'condicion_iva',''), 'consumidor_final')
      )
      returning id into v_cliente_id;
    end if;
  else
    -- Consumidor final genérico del negocio
    select id into v_cliente_id
    from clientes
    where negocio_id = p_negocio_id and nombre = 'Consumidor Final'
    limit 1;
    if v_cliente_id is null then
      insert into clientes (negocio_id, nombre, condicion_iva)
      values (p_negocio_id, 'Consumidor Final', 'consumidor_final')
      returning id into v_cliente_id;
    end if;
  end if;

  -- Serializa numeración por tipo dentro del negocio
  perform 1 from negocios where id = p_negocio_id for update;

  select coalesce(max(numero), 0) + 1 into v_numero
  from facturas
  where negocio_id = p_negocio_id and tipo = v_tipo;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_sub := round(
      coalesce((v_item->>'cantidad')::numeric, 1) *
      coalesce((v_item->>'precio_unitario')::numeric, 0), 2);
    v_subtotal := v_subtotal + v_item_sub;
  end loop;

  if v_tipo = 'A' then
    v_iva := round(v_subtotal * 0.21, 2);
  else
    v_iva := 0;
  end if;
  v_total := v_subtotal + v_iva;

  insert into facturas (negocio_id, cliente_id, numero, tipo, fecha, subtotal, iva, total, estado, origen)
  values (p_negocio_id, v_cliente_id, v_numero, v_tipo, current_date, v_subtotal, v_iva, v_total, 'borrador', coalesce(p_origen,'partner'))
  returning * into v_factura;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into factura_items (factura_id, descripcion, cantidad, precio_unitario, subtotal)
    values (
      v_factura.id,
      coalesce(v_item->>'descripcion', ''),
      coalesce((v_item->>'cantidad')::numeric, 1),
      coalesce((v_item->>'precio_unitario')::numeric, 0),
      round(coalesce((v_item->>'cantidad')::numeric, 1) *
            coalesce((v_item->>'precio_unitario')::numeric, 0), 2)
    );
  end loop;

  return to_jsonb(v_factura);
end;
$$;

-- Solo la service_role de la Partner API puede ejecutarla
revoke all on function crear_factura_partner(uuid, jsonb, jsonb, char, text) from public;
revoke execute on function crear_factura_partner(uuid, jsonb, jsonb, char, text) from anon, authenticated;
grant execute on function crear_factura_partner(uuid, jsonb, jsonb, char, text) to service_role;

-- ============================================================
-- Alta de una app partner (correr UNA vez por producto del ecosistema).
-- Reemplazá el client_secret_hash por el SHA-256 hex del secreto que generes,
-- y las redirect_uris/webhook por las reales de la app externa. Ejemplo:
--
--   insert into partner_apps (nombre, client_id, client_secret_hash, redirect_uris, webhook_url, webhook_secret)
--   values (
--     'Soporte Móvil',
--     'soporte-movil',
--     '<sha256_hex_del_secreto>',
--     array['https://soportemovil.netlify.app/api/facturacion/callback'],
--     'https://soportemovil.netlify.app/api/facturacion/webhook',
--     '<secreto_para_firmar_webhooks>'
--   );
-- ============================================================
