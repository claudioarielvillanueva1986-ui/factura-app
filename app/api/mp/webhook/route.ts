import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { procesarEventoMP } from "@/lib/mp";
import { verificarFirmaMP } from "@/lib/mpWebhookAuth";

export const runtime = "nodejs";
export const maxDuration = 26;

// Webhook ÚNICO de plataforma (cuentas conectadas por OAuth).
// Se configura una sola vez en el panel de la aplicación de Mercado Pago:
//   {NEXT_PUBLIC_APP_URL}/api/mp/webhook  →  evento "Pagos"
// MP incluye user_id del vendedor en la notificación; con eso resolvemos
// el negocio. Siempre responde 200 para evitar reintentos infinitos.
export async function POST(request: NextRequest) {
  const admin = createSupabaseAdminClient();

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    // notificaciones viejas llegan solo con query params
  }

  const tipo =
    (payload.type as string) ??
    (payload.topic as string) ??
    request.nextUrl.searchParams.get("type") ??
    request.nextUrl.searchParams.get("topic");

  const paymentId =
    ((payload.data as Record<string, unknown>)?.id as string | number | undefined) ??
    request.nextUrl.searchParams.get("data.id") ??
    request.nextUrl.searchParams.get("id");

  const mpUserId = payload.user_id != null ? String(payload.user_id) : null;

  if (!verificarFirmaMP(request, paymentId != null ? String(paymentId) : null)) {
    console.warn("Webhook MP: firma inválida, se descarta la notificación.");
    return NextResponse.json({ ok: true });
  }

  await procesarEventoMP(admin, {
    mpUserId: mpUserId ?? undefined,
    tipo: tipo ?? null,
    paymentId: paymentId != null ? String(paymentId) : null,
    payload,
  });

  return NextResponse.json({ ok: true });
}

// MP hace un GET de prueba al configurar la URL
export async function GET() {
  return NextResponse.json({ ok: true, servicio: "facturá webhook MP (plataforma)" });
}
