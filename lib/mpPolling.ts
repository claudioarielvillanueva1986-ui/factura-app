import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerAccessTokenMP, procesarEventoMP } from "@/lib/mp";

// Red de seguridad: recorre los pagos aprobados de cada negocio con MP
// conectado y auto_facturar, y factura los que el webhook no cubrió (cobros
// por terminal Point standalone, QR nativo de MP, links, etc.). Reusa
// procesarEventoMP, así hereda idempotencia (índice único
// facturas_mp_payment_unico), el gate de transferencias y la emisión ARCA.

const MP_API = "https://api.mercadopago.com";
const SOLAPAMIENTO_MIN = 15; // se busca desde (ultimo_polling - 15m) para no perder pagos del borde
const LOOKBACK_INICIAL_H = 72; // primera corrida sin marca previa: mira las últimas 72 h
const PAGE = 50;
// Tope de emisiones por corrida: ARCA es lento (WSAA+WSFE) y la función tiene
// ~26 s. Con corridas frecuentes + idempotencia, un backlog se drena en varias
// corridas sin perder nada (los ya facturados se filtran).
// Con el TA de WSAA cacheado y compartido (lib/arca.ts), varias emisiones
// seguidas reusan un mismo login, así que se puede subir el tope por corrida.
const MAX_POR_CORRIDA = 8;

interface PagoBusqueda {
  id: number;
  status: string;
  date_created: string;
}

export interface ResumenPolling {
  negocios: number;
  pagos_nuevos: number;
  procesados: number;
  errores: number;
}

export async function pollearPagosMP(admin: SupabaseClient): Promise<ResumenPolling> {
  const ahora = new Date();
  const resumen: ResumenPolling = { negocios: 0, pagos_nuevos: 0, procesados: 0, errores: 0 };

  // Solo negocios conectados y con auto-facturación: el polling existe para
  // auto-facturar lo que se perdió; si el negocio factura a mano, no toca nada.
  const { data: configs } = await admin
    .from("mercadopago_config")
    .select("negocio_id, ultimo_polling_en, conectado, auto_facturar")
    .eq("conectado", true)
    .eq("auto_facturar", true);

  for (const cfg of configs ?? []) {
    resumen.negocios++;
    const negocioId = cfg.negocio_id as string;
    const desde = cfg.ultimo_polling_en
      ? new Date(new Date(cfg.ultimo_polling_en).getTime() - SOLAPAMIENTO_MIN * 60_000)
      : new Date(ahora.getTime() - LOOKBACK_INICIAL_H * 3_600_000);

    const log = (patch: Record<string, unknown>) =>
      admin.from("mp_polling_logs").insert({
        negocio_id: negocioId,
        desde: desde.toISOString(),
        hasta: ahora.toISOString(),
        ...patch,
      });

    try {
      const token = await obtenerAccessTokenMP(admin, negocioId);
      if (!token) {
        resumen.errores++;
        await log({ resultado: "sin token", error: "negocio sin MP conectado" });
        continue;
      }

      // 1) Buscar pagos aprobados en la ventana (más viejos primero, para
      // drenar backlog de forma justa).
      const pagos: PagoBusqueda[] = [];
      let offset = 0;
      for (;;) {
        const url =
          `${MP_API}/v1/payments/search?sort=date_created&criteria=asc&status=approved` +
          `&range=date_created&begin_date=${encodeURIComponent(desde.toISOString())}` +
          `&end_date=${encodeURIComponent(ahora.toISOString())}&limit=${PAGE}&offset=${offset}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const detalle = await res.text().catch(() => "");
          throw new Error(`MP search ${res.status}: ${detalle.slice(0, 200)}`);
        }
        const data = (await res.json()) as { results?: PagoBusqueda[] };
        const results = data.results ?? [];
        pagos.push(...results);
        if (results.length < PAGE || pagos.length >= 500) break;
        offset += PAGE;
      }

      // 2) Filtrar los que ya tienen factura (idempotencia con el webhook).
      const ids = pagos.map((p) => String(p.id));
      const yaFacturados = new Set<string>();
      if (ids.length) {
        const { data: fact } = await admin
          .from("facturas")
          .select("mp_payment_id")
          .eq("negocio_id", negocioId)
          .in("mp_payment_id", ids);
        for (const f of fact ?? []) yaFacturados.add(f.mp_payment_id as string);
      }
      const nuevos = pagos.filter((p) => !yaFacturados.has(String(p.id)));

      // 3) Procesar hasta el tope; el resto queda para la próxima corrida.
      const aProcesar = nuevos.slice(0, MAX_POR_CORRIDA);
      const capado = nuevos.length > aProcesar.length;

      for (const p of aProcesar) {
        await procesarEventoMP(admin, {
          negocioId,
          tipo: "payment",
          paymentId: String(p.id),
          payload: { origen: "polling", payment_id: p.id, date_created: p.date_created },
        });
      }

      resumen.pagos_nuevos += nuevos.length;
      resumen.procesados += aProcesar.length;

      // 4) Avanzar la marca solo si NO quedó backlog: así la próxima corrida
      // vuelve a mirar la misma ventana y toma los que faltaron (los ya
      // facturados se filtran en el paso 2). Sin capado, avanzamos a "ahora".
      if (!capado) {
        await admin
          .from("mercadopago_config")
          .update({ ultimo_polling_en: ahora.toISOString() })
          .eq("negocio_id", negocioId);
      }

      await log({
        pagos_nuevos: nuevos.length,
        procesados: aProcesar.length,
        capado,
        resultado: capado
          ? `parcial: ${aProcesar.length}/${nuevos.length} procesados, resto en la próxima corrida`
          : `ok: ${aProcesar.length} pagos nuevos procesados`,
      });
    } catch (e) {
      resumen.errores++;
      await log({ resultado: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return resumen;
}
