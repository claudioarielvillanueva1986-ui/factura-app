import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { pollearPagosMP } from "@/lib/mpPolling";

export const runtime = "nodejs";
export const maxDuration = 26; // límite de Netlify Functions; ARCA es lento

// Corre el polling de pagos de MP (red de seguridad de la auto-facturación).
// Lo dispara la Scheduled Function de Netlify (netlify/functions/mp-polling)
// con el header x-cron-secret; no lleva sesión de usuario.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provisto = request.headers.get("x-cron-secret");
  if (!secret || provisto !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const resumen = await pollearPagosMP(admin);
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
