import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { procesarEventoMP } from "@/lib/mp";

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
