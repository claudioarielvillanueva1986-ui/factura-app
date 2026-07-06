-- ============================================================
-- facturá. — 009: suscripciones y administración de plataforma
-- ============================================================

-- ---------- Admins de la plataforma ----------
-- Separado de usuarios.rol ('admin'/'operador' es dentro de UN negocio).
-- Un admin de plataforma ve y gestiona TODOS los negocios (vos, Claudio).
create table plataforma_admins (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);

alter table plataforma_admins enable row level security;
-- Sin policies para authenticated: no hace falta leer esta tabla directo,
-- solo se consulta indirectamente vía es_admin_plataforma().

create or replace function es_admin_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from plataforma_admins where usuario_id = auth.uid())
$$;

revoke execute on function es_admin_plataforma() from public, anon;
grant execute on function es_admin_plataforma() to authenticated;

-- ---------- Configuración global (singleton) ----------
create table configuracion_plataforma (
  id boolean primary key default true check (id),
  precio_mensual numeric(14, 2) not null default 9999,
  dias_trial_default int not null default 7,
  dias_gracia_default int not null default 3,
  updated_at timestamptz not null default now()
);
insert into configuracion_plataforma (id) values (true);

alter table configuracion_plataforma enable row level security;

create policy configuracion_plataforma_select on configuracion_plataforma
  for select to authenticated
  using (true);

create policy configuracion_plataforma_update on configuracion_plataforma
  for update to authenticated
  using (es_admin_plataforma())
  with check (es_admin_plataforma());

-- ---------- Facturación del negocio (suscripción a facturá.) ----------
create type estado_cuenta_negocio as enum ('trial', 'activo', 'gracia', 'suspendido', 'cancelado');

alter table negocios
  add column estado_cuenta estado_cuenta_negocio not null default 'trial',
  add column gracia_hasta date,
  add column mp_preapproval_id text,
  add column precio_mensual numeric(14, 2),
  add column notas_admin text,
  add column suscripcion_cancelada_en timestamptz;

-- ---------- Historial de cobros de suscripción ----------
create table pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios (id) on delete cascade,
  mp_payment_id text,
  mp_preapproval_id text,
  monto numeric(14, 2) not null,
  estado text not null,
  periodo_desde date,
  periodo_hasta date,
  created_at timestamptz not null default now()
);

create index pagos_suscripcion_negocio_idx on pagos_suscripcion (negocio_id, created_at desc);

alter table pagos_suscripcion enable row level security;

-- El negocio ve su propio historial (solo lectura)
create policy pagos_suscripcion_select_propio on pagos_suscripcion
  for select to authenticated
  using (negocio_id = mi_negocio_id());

-- El admin de plataforma ve todos los pagos de todos los negocios
create policy pagos_suscripcion_select_admin on pagos_suscripcion
  for select to authenticated
  using (es_admin_plataforma());
-- Sin policy de insert/update/delete: solo service_role (webhook de MP) escribe.

-- ---------- Enforcement: ¿puede este negocio emitir facturas? ----------
create or replace function cuenta_habilitada_para_facturar(p_negocio_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_negocio negocios%rowtype;
begin
  select * into v_negocio from negocios where id = p_negocio_id;
  if not found then
    return false;
  end if;

  if v_negocio.estado_cuenta in ('suspendido', 'cancelado') then
    return false;
  end if;

  if v_negocio.estado_cuenta = 'activo' then
    return true;
  end if;

  if v_negocio.estado_cuenta = 'trial' then
    return v_negocio.trial_hasta is null or v_negocio.trial_hasta >= current_date;
  end if;

  if v_negocio.estado_cuenta = 'gracia' then
    return v_negocio.gracia_hasta is not null and v_negocio.gracia_hasta >= current_date;
  end if;

  return false;
end;
$$;

revoke execute on function cuenta_habilitada_para_facturar(uuid) from public, anon;
grant execute on function cuenta_habilitada_para_facturar(uuid) to authenticated;

-- ---------- crear_factura: bloquear si la cuenta no está habilitada ----------
create or replace function crear_factura(
  p_tipo       char,
  p_cliente_id uuid,
  p_items      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio_id uuid;
  v_condicion  condicion_iva_negocio;
  v_numero     int;
  v_subtotal   numeric(14,2) := 0;
  v_iva        numeric(14,2) := 0;
  v_total      numeric(14,2) := 0;
  v_factura    facturas%rowtype;
  v_item       jsonb;
  v_item_sub   numeric(14,2);
begin
  select u.negocio_id, n.condicion_iva
    into v_negocio_id, v_condicion
  from usuarios u
  join negocios n on n.id = u.negocio_id
  where u.id = auth.uid();

  if v_negocio_id is null then
    raise exception 'No autenticado';
  end if;

  if not cuenta_habilitada_para_facturar(v_negocio_id) then
    raise exception 'Tu cuenta no está habilitada para emitir facturas. Activá tu suscripción en Configuración → Suscripción.';
  end if;

  if p_tipo not in ('A', 'B', 'C') then
    raise exception 'Tipo de comprobante inválido: %', p_tipo;
  end if;

  if v_condicion = 'monotributo' and p_tipo <> 'C' then
    raise exception 'Un monotributista solo puede emitir facturas C';
  end if;

  if p_cliente_id is not null and not exists (
    select 1 from clientes where id = p_cliente_id and negocio_id = v_negocio_id
  ) then
    raise exception 'Cliente inexistente';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura necesita al menos un ítem';
  end if;

  perform 1 from negocios where id = v_negocio_id for update;

  select coalesce(max(numero), 0) + 1 into v_numero
  from facturas
  where negocio_id = v_negocio_id and tipo = p_tipo;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_sub := round(
      coalesce((v_item->>'cantidad')::numeric, 1) *
      coalesce((v_item->>'precio_unitario')::numeric, 0), 2);
    v_subtotal := v_subtotal + v_item_sub;
  end loop;

  if p_tipo = 'A' then
    v_iva := round(v_subtotal * 0.21, 2);
  else
    v_iva := 0;
  end if;
  v_total := v_subtotal + v_iva;

  insert into facturas (negocio_id, cliente_id, numero, tipo, fecha, subtotal, iva, total, estado, origen)
  values (v_negocio_id, p_cliente_id, v_numero, p_tipo, current_date, v_subtotal, v_iva, v_total, 'borrador', 'manual')
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

revoke execute on function crear_factura(char, uuid, jsonb) from public, anon;
grant execute on function crear_factura(char, uuid, jsonb) to authenticated;

-- ---------- crear_factura_mp: mismo enforcement para auto-facturación ----------
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

  if not cuenta_habilitada_para_facturar(p_negocio_id) then
    raise exception 'La cuenta no está habilitada para emitir facturas (trial/suscripción vencidos).';
  end if;

  select * into v_factura
  from facturas
  where negocio_id = p_negocio_id and mp_payment_id = p_payment_id;
  if found then
    return to_jsonb(v_factura);
  end if;

  v_tipo := case when v_condicion = 'monotributo' then 'C' else 'B' end;

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

revoke all on function crear_factura_mp(uuid, text, numeric, text, text) from public;
revoke execute on function crear_factura_mp(uuid, text, numeric, text, text) from anon, authenticated;
grant execute on function crear_factura_mp(uuid, text, numeric, text, text) to service_role;

-- ---------- crear_negocio_inicial: trial configurable + estado_cuenta ----------
create or replace function crear_negocio_inicial(
  nombre_negocio text,
  nombre_usuario text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_negocio_id uuid;
  v_dias_trial int;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select negocio_id into v_negocio_id from usuarios where id = v_uid;
  if v_negocio_id is not null then
    return v_negocio_id;
  end if;

  select dias_trial_default into v_dias_trial from configuracion_plataforma limit 1;
  v_dias_trial := coalesce(v_dias_trial, 7);

  insert into negocios (nombre, plan, trial_hasta, estado_cuenta)
  values (nombre_negocio, 'trial', current_date + (v_dias_trial || ' days')::interval, 'trial')
  returning id into v_negocio_id;

  insert into usuarios (id, negocio_id, nombre, rol)
  values (v_uid, v_negocio_id, nombre_usuario, 'admin');

  return v_negocio_id;
end;
$$;

revoke execute on function crear_negocio_inicial(text, text) from public, anon;
grant execute on function crear_negocio_inicial(text, text) to authenticated;

-- ---------- RPCs de administración de plataforma ----------

-- Listado completo de negocios con métricas básicas, para el panel admin.
create or replace function admin_listar_negocios()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not es_admin_plataforma() then
    raise exception 'No autorizado';
  end if;

  return (
    select coalesce(jsonb_agg(fila order by (fila->>'created_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', n.id,
        'nombre', n.nombre,
        'cuit', n.cuit,
        'razon_social', n.razon_social,
        'plan', n.plan,
        'estado_cuenta', n.estado_cuenta,
        'trial_hasta', n.trial_hasta,
        'gracia_hasta', n.gracia_hasta,
        'precio_mensual', n.precio_mensual,
        'mp_preapproval_id', n.mp_preapproval_id,
        'notas_admin', n.notas_admin,
        'created_at', n.created_at,
        'habilitada', cuenta_habilitada_para_facturar(n.id),
        'usuarios_count', (select count(*) from usuarios u where u.negocio_id = n.id),
        'facturas_count', (select count(*) from facturas f where f.negocio_id = n.id),
        'ultimo_pago', (
          select jsonb_build_object('monto', p.monto, 'estado', p.estado, 'fecha', p.created_at)
          from pagos_suscripcion p
          where p.negocio_id = n.id
          order by p.created_at desc
          limit 1
        )
      ) as fila
      from negocios n
    ) t
  );
end;
$$;

revoke execute on function admin_listar_negocios() from public, anon;
grant execute on function admin_listar_negocios() to authenticated;

-- Actualización parcial de un negocio (extender trial, gracia, precio,
-- notas, suspender/reactivar). Los campos NULL no se tocan.
create or replace function admin_actualizar_negocio(
  p_negocio_id     uuid,
  p_trial_hasta    date default null,
  p_gracia_hasta   date default null,
  p_estado_cuenta  estado_cuenta_negocio default null,
  p_precio_mensual numeric default null,
  p_notas_admin    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio negocios%rowtype;
begin
  if not es_admin_plataforma() then
    raise exception 'No autorizado';
  end if;

  update negocios set
    trial_hasta    = coalesce(p_trial_hasta, trial_hasta),
    gracia_hasta   = coalesce(p_gracia_hasta, gracia_hasta),
    estado_cuenta  = coalesce(p_estado_cuenta, estado_cuenta),
    precio_mensual = coalesce(p_precio_mensual, precio_mensual),
    notas_admin    = coalesce(p_notas_admin, notas_admin)
  where id = p_negocio_id
  returning * into v_negocio;

  if not found then
    raise exception 'Negocio no encontrado';
  end if;

  return to_jsonb(v_negocio);
end;
$$;

revoke execute on function admin_actualizar_negocio(uuid, date, date, estado_cuenta_negocio, numeric, text) from public, anon;
grant execute on function admin_actualizar_negocio(uuid, date, date, estado_cuenta_negocio, numeric, text) to authenticated;

-- Historial de pagos (de un negocio puntual o de todos)
create or replace function admin_listar_pagos(p_negocio_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not es_admin_plataforma() then
    raise exception 'No autorizado';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
    from pagos_suscripcion p
    where p_negocio_id is null or p.negocio_id = p_negocio_id
  );
end;
$$;

revoke execute on function admin_listar_pagos(uuid) from public, anon;
grant execute on function admin_listar_pagos(uuid) to authenticated;
