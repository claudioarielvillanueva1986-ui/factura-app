import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { obtenerAccessTokenMP } from "@/lib/mp";
import { crearPreferenciaCobro } from "@/lib/mpCobros";

export const runtime = "nodejs";

interface Body {
  monto?: number;
  descripcion?: string;
  external_reference?: string; // referencia propia del partner (idempotencia)
  facturar?: boolean; // default true: al aprobarse el pago, se factura y emite
}

// Crea un cobro de Mercado Pago (link/QR de Checkout Pro) en la cuenta MP
// conectada del negocio. Devuelve init_point para mostrar como link o QR.
// La confirmación llega por webhook y —si facturar=true— dispara la emisión.
export async function POST(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "cobros");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { negocioId, appId } = auth.ctx;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL no configurado" }, { status: 500 });
  }

  // Idempotencia por referencia del partner
  if (body.external_reference) {
    const { data: previo } = await admin
      .from("cobros")
      .select("id, estado, init_point, mp_preference_id")
      .eq("negocio_id", negocioId)
      .eq("app_id", appId)
      .eq("external_reference", body.external_reference)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        cobro_id: previo.id,
        estado: previo.estado,
        init_point: previo.init_point,
        idempotente: true,
      });
    }
  }

  const accessToken = await obtenerAccessTokenMP(admin, negocioId);
  if (!accessToken) {
    return NextResponse.json(
      { error: "El negocio no tiene Mercado Pago conectado en facturá." },
      { status: 409 }
    );
  }

  // 1) Registrar el cobro para obtener su id (external_reference hacia MP)
  const { data: cobro, error: errIns } = await admin
    .from("cobros")
    .insert({
      negocio_id: negocioId,
      app_id: appId,
      external_reference: body.external_reference ?? null,
      monto,
      descripcion: body.descripcion ?? null,
      facturar: body.facturar ?? true,
      estado: "pendiente",
    })
    .select("id")
    .single();

  if (errIns || !cobro) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo crear el cobro" }, { status: 500 });
  }

  // 2) Crear la preferencia de MP con external_reference = id del cobro
  try {
    const pref = await crearPreferenciaCobro(accessToken, {
      monto,
      descripcion: body.descripcion ?? "Cobro",
      externalReference: cobro.id,
      negocioId,
      appUrl,
    });

    await admin
      .from("cobros")
      .update({ mp_preference_id: pref.id, init_point: pref.init_point, updated_at: new Date().toISOString() })
      .eq("id", cobro.id);

    return NextResponse.json({
      cobro_id: cobro.id,
      estado: "pendiente",
      init_point: pref.init_point,
      preference_id: pref.id,
    });
  } catch (e) {
    await admin
      .from("cobros")
      .update({ estado: "cancelado", updated_at: new Date().toISOString() })
      .eq("id", cobro.id);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo crear la preferencia de MP" },
      { status: 502 }
    );
  }
}
