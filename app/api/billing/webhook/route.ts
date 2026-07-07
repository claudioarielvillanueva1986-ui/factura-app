import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sincronizarPreapproval, obtenerPreapproval } from "@/lib/mpSuscripcion";
import { verificarFirmaMP } from "@/lib/mpWebhookAuth";

export const runtime = "nodejs";
export const maxDuration = 26;

// Webhook de la cuenta PROPIA de la plataforma (cobro de suscripciones).
// Se configura una sola vez en el panel de la aplicación de Mercado Pago
// asociada a PLATAFORMA_MP_ACCESS_TOKEN:
//   {NEXT_PUBLIC_APP_URL}/api/billing/webhook  →  eventos "Suscripciones"
// MP notifica altas/pausas/cancelaciones (type: subscription_preapproval /
// preapproval) y cobros exitosos (type: subscription_authorized_payment).
// Siempre responde 200 para evitar reintentos infinitos.
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

  const dataId =
    ((payload.data as Record<string, unknown>)?.id as string | undefined) ??
    request.nextUrl.searchParams.get("data.id") ??
    request.nextUrl.searchParams.get("id");

  const log = async (resultado: string, error?: string) => {
    await admin.from("mp_webhook_logs").insert({
      negocio_id: null,
      payload: { tipo, dataId, ...payload },
      resultado,
      error: error ?? null,
    });
  };

  if (!verificarFirmaMP(request, dataId ?? null)) {
    await log("ignorado: firma inválida");
    return NextResponse.json({ ok: true });
  }

  if (!tipo || !dataId) {
    await log("ignorado: sin tipo o data.id");
    return NextResponse.json({ ok: true });
  }

  try {
    if (tipo === "subscription_preapproval" || tipo === "preapproval") {
      await sincronizarPreapproval(admin, dataId);
      await log(`preapproval ${dataId} sincronizado`);
    } else if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
      // El cobro recurrente generó un pago; lo consultamos y lo logueamos.
      // El preapproval asociado ya trae el negocio en external_reference.
      const res = await fetch(`https://api.mercadopago.com/authorized_payments/${dataId}`, {
        headers: { Authorization: `Bearer ${process.env.PLATAFORMA_MP_ACCESS_TOKEN}` },
      });
      const pago = await res.json();
      const preapprovalId = pago.preapproval_id as string | undefined;
      if (preapprovalId) {
        const preapproval = await obtenerPreapproval(preapprovalId);
        const negocioId = (preapproval as unknown as { external_reference?: string })
          .external_reference;
        if (negocioId) {
          // Idempotente: MP reintenta el webhook si no recibe 200 a tiempo.
          await admin.from("pagos_suscripcion").upsert(
            {
              negocio_id: negocioId,
              mp_payment_id: String(dataId),
              mp_preapproval_id: preapprovalId,
              monto: pago.transaction_amount ?? 0,
              estado: pago.status ?? "unknown",
            },
            { onConflict: "mp_payment_id", ignoreDuplicates: false }
          );
          if (pago.status === "approved") {
            await admin.from("negocios").update({ estado_cuenta: "activo" }).eq("id", negocioId);
          }
        }
      }
      await log(`authorized_payment ${dataId} registrado`);
    } else {
      await log(`ignorado: tipo ${tipo} no manejado`);
    }
  } catch (error) {
    await log("error", error instanceof Error ? error.message : String(error));
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, servicio: "facturá webhook de suscripciones" });
}
