import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { emitirFacturaARCA } from "@/lib/arca";

export const runtime = "nodejs";
export const maxDuration = 26;

// Webhook de Mercado Pago: auto-facturación de pagos aprobados.
// Siempre responde 200 (salvo negocio inexistente) para que MP no reintente
// indefinidamente; los errores quedan en mp_webhook_logs.
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

  const log = async (resultado: string, error?: string) => {
    await admin.from("mp_webhook_logs").insert({
      negocio_id,
      payload,
      resultado,
      error: error ?? null,
    });
  };

  try {
    // Solo procesamos notificaciones de pagos
    const tipo =
      (payload.type as string) ??
      (payload.topic as string) ??
      request.nextUrl.searchParams.get("type") ??
      request.nextUrl.searchParams.get("topic");

    if (tipo !== "payment") {
      await log("ignorado: tipo distinto de payment");
      return NextResponse.json({ ok: true });
    }

    const paymentId =
      ((payload.data as Record<string, unknown>)?.id as string | number | undefined) ??
      request.nextUrl.searchParams.get("data.id") ??
      request.nextUrl.searchParams.get("id");

    if (!paymentId) {
      await log("ignorado: sin payment id");
      return NextResponse.json({ ok: true });
    }

    const { data: config } = await admin
      .from("mercadopago_config")
      .select("access_token, auto_facturar")
      .eq("negocio_id", negocio_id)
      .maybeSingle();

    if (!config?.access_token) {
      await log("error", "Negocio sin access_token de Mercado Pago configurado");
      return NextResponse.json({ ok: true });
    }

    // Consultar el pago en la API de MP (también valida que la notificación sea real)
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${config.access_token}` },
    });

    if (!mpRes.ok) {
      await log("error", `MP API respondió ${mpRes.status} al consultar el pago ${paymentId}`);
      return NextResponse.json({ ok: true });
    }

    const pago = (await mpRes.json()) as {
      id: number;
      status: string;
      transaction_amount: number;
      description?: string;
      payer?: { phone?: { area_code?: string; number?: string } };
    };

    if (pago.status !== "approved") {
      await log(`ignorado: pago ${paymentId} con status ${pago.status}`);
      return NextResponse.json({ ok: true });
    }

    if (!config.auto_facturar) {
      await log("ignorado: auto_facturar desactivado");
      return NextResponse.json({ ok: true });
    }

    // Idempotencia: si ya existe factura para este pago, no duplicar
    const { data: existente } = await admin
      .from("facturas")
      .select("id")
      .eq("negocio_id", negocio_id)
      .eq("mp_payment_id", String(paymentId))
      .maybeSingle();

    if (existente) {
      await log(`ignorado: pago ${paymentId} ya facturado (${existente.id})`);
      return NextResponse.json({ ok: true });
    }

    const telefono =
      pago.payer?.phone?.number
        ? `${pago.payer.phone.area_code ?? ""}${pago.payer.phone.number}`
        : null;

    const { data: factura, error: errRpc } = await admin.rpc("crear_factura_mp", {
      p_negocio_id: negocio_id,
      p_payment_id: String(paymentId),
      p_monto: pago.transaction_amount,
      p_descripcion: pago.description ?? `Pago Mercado Pago ${paymentId}`,
      p_telefono_pagador: telefono,
    });

    if (errRpc) {
      await log("error", `crear_factura_mp: ${errRpc.message}`);
      return NextResponse.json({ ok: true });
    }

    const facturaId = (factura as { id: string }).id;

    // Emitir contra ARCA. Si falla, la factura queda en estado 'error'
    // con el mensaje amigable y se puede reintentar desde la app.
    const emision = await emitirFacturaARCA(facturaId);

    await log(
      emision.ok
        ? `facturado: pago ${paymentId} → factura ${facturaId} CAE ${emision.cae}` +
            (telefono ? " (pendiente envío WA)" : "")
        : `factura ${facturaId} creada pero falló la emisión`,
      emision.ok ? undefined : emision.error
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    await log("error", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: true });
  }
}

// MP hace un GET de prueba al configurar la URL
export async function GET() {
  return NextResponse.json({ ok: true, servicio: "facturá webhook MP" });
}
