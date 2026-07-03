-- ============================================================
-- facturá. — 003: RPC resumen_dashboard
-- ============================================================

-- Devuelve el resumen del dashboard filtrado por el negocio del usuario
-- autenticado. SECURITY DEFINER + filtro explícito por negocio_id.
create or replace function resumen_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_negocio_id uuid;
  v_result     jsonb;
begin
  select negocio_id into v_negocio_id from usuarios where id = auth.uid();
  if v_negocio_id is null then
    raise exception 'No autenticado';
  end if;

  select jsonb_build_object(
    'total_hoy', coalesce((
      select sum(total) from facturas
      where negocio_id = v_negocio_id
        and fecha = current_date
        and estado in ('emitida', 'enviada')
    ), 0),
    'total_mes', coalesce((
      select sum(total) from facturas
      where negocio_id = v_negocio_id
        and date_trunc('month', fecha) = date_trunc('month', current_date)
        and estado in ('emitida', 'enviada')
    ), 0),
    'cantidad_mes', coalesce((
      select count(*) from facturas
      where negocio_id = v_negocio_id
        and date_trunc('month', fecha) = date_trunc('month', current_date)
        and estado in ('emitida', 'enviada')
    ), 0),
    'auto_mp', coalesce((
      select count(*) from facturas
      where negocio_id = v_negocio_id
        and date_trunc('month', fecha) = date_trunc('month', current_date)
        and origen = 'mercadopago'
        and estado in ('emitida', 'enviada')
    ), 0),
    'sin_enviar', coalesce((
      select count(*) from facturas
      where negocio_id = v_negocio_id
        and estado = 'emitida'
        and wa_enviado = false
    ), 0),
    'semana', (
      select coalesce(jsonb_agg(dia_row order by dia_fecha), '[]'::jsonb)
      from (
        select
          d.dia_fecha,
          jsonb_build_object(
            'dia', to_char(d.dia_fecha, 'DD/MM'),
            'manual', coalesce(sum(f.total) filter (where f.origen <> 'mercadopago'), 0),
            'auto_mp', coalesce(sum(f.total) filter (where f.origen = 'mercadopago'), 0)
          ) as dia_row
        from generate_series(current_date - 6, current_date, '1 day'::interval) as d(dia_fecha)
        left join facturas f
          on f.negocio_id = v_negocio_id
          and f.fecha = d.dia_fecha::date
          and f.estado in ('emitida', 'enviada')
        group by d.dia_fecha
      ) semana_dias
    ),
    'ultimas', (
      select coalesce(jsonb_agg(fila), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', f.id,
          'numero', f.numero,
          'tipo', f.tipo,
          'fecha', f.fecha,
          'total', f.total,
          'estado', f.estado,
          'origen', f.origen,
          'wa_enviado', f.wa_enviado,
          'cliente_nombre', coalesce(c.nombre, 'Consumidor Final')
        ) as fila
        from facturas f
        left join clientes c on c.id = f.cliente_id
        where f.negocio_id = v_negocio_id
        order by f.created_at desc
        limit 5
      ) ultimas_facturas
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function resumen_dashboard() from public;
grant execute on function resumen_dashboard() to authenticated;
