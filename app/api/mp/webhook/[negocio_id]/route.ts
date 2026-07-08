import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { procesarEventoMP } from "@/lib/mp";
import { verificarFirmaMP } from "@/lib/mpWebhookAuth";

export const runtime = "nodejs";
export const maxDuration = 26;

// Webhook por negocio (modo manual: access token pegado a mano).
// Con OAuth se usa el webhook único de plataforma (/api/mp/webhook);
// esta ruta queda para configuraciones manuales existentes.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ negocio_id: string }> }
) {
  const { negocio_id } = await params;
  const admin = createSupabaseAdminClient();

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    // MP a veces manda query params sin body (topic/id)
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

  // Firma informativa: si no valida se registra pero se procesa igual (la
  // seguridad real es la re-consulta del pago contra la API de MP).
  if (!verificarFirmaMP(request, paymentId != null ? String(paymentId) : null)) {
    console.warn("Webhook MP (manual): firma inválida; se procesa igual (se revalida contra la API de MP).");
    await admin.from("mp_webhook_logs").insert({
      negocio_id: negocio_id,
      payload: { tipo, paymentId, ...payload },
      resultado: "aviso: firma inválida (se procesa igual)",
      error: "x-signature no coincide o MP_WEBHOOK_SECRET ausente/incorrecto",
    });
  }

  await procesarEventoMP(admin, {
    negocioId: negocio_id,
    tipo: tipo ?? null,
    paymentId: paymentId != null ? String(paymentId) : null,
    payload,
  });

  return NextResponse.json({ ok: true });
}

// MP hace un GET de prueba al configurar la URL
export async function GET() {
  return NextResponse.json({ ok: true, servicio: "facturá webhook MP" });
}
