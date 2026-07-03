-- ============================================================
-- facturá. — 004: RPC crear_factura
-- ============================================================

-- Crea una factura en estado borrador con sus ítems, numerando por tipo
-- dentro del negocio. Solo tipo A discrimina IVA (21%).
-- items: [{ "descripcion": text, "cantidad": numeric, "precio_unitario": numeric }]
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

  -- Bloquea el negocio para serializar la numeración por tipo
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

  -- Solo la factura A discrimina IVA 21%
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

revoke all on function crear_factura(char, uuid, jsonb) from public;
grant execute on function crear_factura(char, uuid, jsonb) to authenticated;
