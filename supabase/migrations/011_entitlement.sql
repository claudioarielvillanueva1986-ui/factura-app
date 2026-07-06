-- ============================================================
-- facturá. — 011: entitlement por partner (combo del ecosistema)
--
-- Cuando un producto del ecosistema (ej: Soporte Móvil) vende a facturá.
-- como parte de un combo, el cliente paga UNA sola suscripción en ese
-- producto y NO se le cobra la suscripción de facturá. por separado.
-- El partner "habilita" (entitle) la cuenta de facturá. mientras el combo
-- esté pago, extendiendo entitled_hasta periódicamente vía la Partner API.
-- ============================================================

alter table negocios
  add column entitled_by    uuid references partner_apps (id) on delete set null,
  add column entitled_hasta date;

-- cuenta_habilitada_para_facturar ahora también es true si un partner tiene
-- habilitada la cuenta (entitlement vigente), sin importar el estado de la
-- suscripción propia de facturá.
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

  -- Entitlement de partner vigente (combo pago en el producto externo)
  if v_negocio.entitled_hasta is not null and v_negocio.entitled_hasta >= current_date then
    return true;
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

-- Setea el entitlement, verificando que el negocio esté efectivamente
-- vinculado al partner (tiene al menos un grant vivo de esa app). Corre con
-- service_role desde el endpoint de la Partner API.
create or replace function partner_set_entitlement(
  p_app_id     uuid,
  p_negocio_id uuid,
  p_hasta      date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vinculado boolean;
begin
  select exists (
    select 1 from partner_grants g
    where g.app_id = p_app_id and g.negocio_id = p_negocio_id and g.revocado = false
  ) into v_vinculado;

  if not v_vinculado then
    raise exception 'El negocio no está vinculado a esta aplicación';
  end if;

  update negocios
     set entitled_by = p_app_id,
         entitled_hasta = p_hasta
   where id = p_negocio_id;

  return true;
end;
$$;

revoke all on function partner_set_entitlement(uuid, uuid, date) from public;
revoke execute on function partner_set_entitlement(uuid, uuid, date) from anon, authenticated;
grant execute on function partner_set_entitlement(uuid, uuid, date) to service_role;
