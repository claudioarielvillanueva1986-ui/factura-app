import type { SupabaseClient } from "@supabase/supabase-js";

// Rate limiting sobre Postgres (ver migración 014). Fail-open a propósito: si
// el limitador fallara, NO se bloquea la operación (no queremos que un bug del
// limitador tire abajo la facturación) — solo se loguea.

export interface ResultadoRateLimit {
  ok: boolean;
  limite?: number;
  resetEn?: string; // ISO
  retryAfterSeg?: number;
}

export async function consumirRateLimit(
  admin: SupabaseClient,
  clave: string,
  limite: number,
  ventanaSeg: number
): Promise<ResultadoRateLimit> {
  const { data, error } = await admin.rpc("consumir_rate_limit", {
    p_clave: clave,
    p_limite: limite,
    p_ventana_seg: ventanaSeg,
  });

  if (error || !data) {
    console.error("rate limit (fail-open):", error?.message ?? "sin datos");
    return { ok: true };
  }

  const d = data as { permitido: boolean; limite: number; reset_en: string };
  const retryAfterSeg = Math.max(
    1,
    Math.ceil((new Date(d.reset_en).getTime() - Date.now()) / 1000)
  );
  return { ok: d.permitido, limite: d.limite, resetEn: d.reset_en, retryAfterSeg };
}

// Extrae una IP razonable detrás del proxy de Netlify (best-effort, solo para
// limitar; no se confía en ella para autorización).
export function ipDeRequest(request: Request): string {
  const xff = request.headers.get("x-nf-client-connection-ip") ?? request.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0].trim() : "desconocida";
}
