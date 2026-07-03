-- ============================================================
-- facturá. — 005: Mercado Pago (auto-facturación + logs)
-- ============================================================

-- Logs de webhooks para debugging. Solo service_role: RLS sin policies.
create table mp_webhook_logs (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid references negocios (id) on delete cascade,
  payload    jsonb,
  resultado  text,
  error      text,
  created_at timestamptz not null default now()
);

create index mp_webhook_logs_negocio_idx on mp_webhook_logs (negocio_id, created_at desc);

alter table mp_webhook_logs enable row level security;
-- sin policies: solo service_role

-- Crea una factura desde un pago de Mercado Pago.
-- Se llama desde la Netlify Function del webhook (service_role), por eso
-- recibe negocio_id explícito y no depende de auth.uid().
-- Tipo B para responsable inscripto, C para monotributo. Origen 'mercadopago'.
-- Devuelve la factura creada, o la existente si el pago ya fue facturado.
create or replace function crear_factura_mp(
  p_negocio_id       uuid,
  p_payment_id       text,
  p_monto            numeric,
  p_descripcion      text,
  p_telefono_pagador text default null
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
  v_cliente_id uuid;
  v_factura    facturas%rowtype;
begin
  select condicion_iva into v_condicion from negocios where id = p_negocio_id;
  if v_condicion is null then
    raise exception 'Negocio inexistente';
  end if;

  -- Idempotencia: si el pago ya tiene factura, devolverla
  select * into v_factura
  from facturas
  where negocio_id = p_negocio_id and mp_payment_id = p_payment_id;
  if found then
    return to_jsonb(v_factura);
  end if;

  v_tipo := case when v_condicion = 'monotributo' then 'C' else 'B' end;

  -- Cliente genérico "Consumidor Final (MP)" del negocio (find-or-create)
  select id into v_cliente_id
  from clientes
  where negocio_id = p_negocio_id and nombre = 'Consumidor Final (MP)'
  limit 1;

  if v_cliente_id is null then
    insert into clientes (negocio_id, nombre, condicion_iva, telefono)
    values (p_negocio_id, 'Consumidor Final (MP)', 'consumidor_final', p_telefono_pagador)
    returning id into v_cliente_id;
  elsif p_telefono_pagador is not null then
    update clientes set telefono = p_telefono_pagador where id = v_cliente_id;
  end if;

  perform 1 from negocios where id = p_negocio_id for update;

  select coalesce(max(numero), 0) + 1 into v_numero
  from facturas
  where negocio_id = p_negocio_id and tipo = v_tipo;

  -- B/C: sin IVA discriminado (según regla de negocio de crear_factura)
  insert into facturas (
    negocio_id, cliente_id, numero, tipo, fecha,
    subtotal, iva, total, estado, origen, mp_payment_id
  )
  values (
    p_negocio_id, v_cliente_id, v_numero, v_tipo, current_date,
    round(p_monto, 2), 0, round(p_monto, 2), 'borrador', 'mercadopago', p_payment_id
  )
  returning * into v_factura;

  insert into factura_items (factura_id, descripcion, cantidad, precio_unitario, subtotal)
  values (
    v_factura.id,
    coalesce(nullif(p_descripcion, ''), 'Pago Mercado Pago ' || p_payment_id),
    1, round(p_monto, 2), round(p_monto, 2)
  );

  return to_jsonb(v_factura);
end;
$$;

-- Solo la service_role del webhook puede ejecutarla
revoke all on function crear_factura_mp(uuid, text, numeric, text, text) from public;
revoke execute on function crear_factura_mp(uuid, text, numeric, text, text) from anon, authenticated;
grant execute on function crear_factura_mp(uuid, text, numeric, text, text) to service_role;
