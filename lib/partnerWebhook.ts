import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Notificaciones salientes hacia la app externa (partner). Cuando un cobro se
// aprueba (y, si corresponde, se factura), facturá. hace un POST firmado al
// webhook_url registrado de la app. La firma es HMAC-SHA256 del cuerpo con el
// webhook_secret de la app, en el header 'x-factura-signature'.

export interface EventoPartner {
  event: string; // ej: 'cobro.aprobado'
  [k: string]: unknown;
}

// Envía el evento y registra el resultado en cobros.notificado_en (best-effort;
// nunca lanza para no romper el procesamiento del webhook de MP).
export async function notificarPartner(
  admin: SupabaseClient,
  appId: string | null,
  evento: EventoPartner
): Promise<void> {
  if (!appId) return;
  try {
    const { data: app } = await admin
      .from("partner_apps")
      .select("webhook_url, webhook_secret, activo")
      .eq("id", appId)
      .maybeSingle();

    if (!app?.activo || !app.webhook_url) return;

    const cuerpo = JSON.stringify(evento);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (app.webhook_secret) {
      headers["x-factura-signature"] = createHmac("sha256", app.webhook_secret)
        .update(cuerpo)
        .digest("hex");
    }

    await fetch(app.webhook_url, { method: "POST", headers, body: cuerpo });
  } catch {
    // best-effort: la app externa puede reconciliar por polling (GET /cobros/:id)
  }
}
