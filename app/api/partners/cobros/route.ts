import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { obtenerAccessTokenMP } from "@/lib/mp";
import { crearPreferenciaCobro } from "@/lib/mpCobros";
import { crearOrdenPoint } from "@/lib/mpPoint";
import { consumirRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface Body {
  monto?: number;
  descripcion?: string;
  external_reference?: string; // referencia propia del partner (idempotencia)
  facturar?: boolean; // default true: al aprobarse el pago, se factura y emite
  metodo?: "qr" | "point"; // default "qr" (link/QR de Checkout Pro)
  terminal_id?: string; // requerido si metodo="point" — ver GET /api/partners/terminales
  device_id?: string; // alias de terminal_id (nombre usado por la API de MP)
}

// Crea un cobro de Mercado Pago en la cuenta conectada del negocio: por
// default un link/QR de Checkout Pro (metodo="qr"), o —si se pasa
// metodo="point"— lo manda a cobrar a una terminal física Point del negocio.
// La confirmación llega por webhook y —si facturar=true— dispara la emisión.
export async function POST(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "cobros");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { negocioId, appId } = auth.ctx;

  // Rate limit de creación de cobros (llamadas a la API de MP) por negocio.
  const rl = await consumirRateLimit(admin, `cobros:min:${negocioId}`, 60, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiados cobros en poco tiempo, probá más tarde.", reset_en: rl.resetEn },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeg ?? 60) } }
    );
  }

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

  const metodo = body.metodo === "point" ? "point" : "qr";
  const terminalId = body.terminal_id ?? body.device_id ?? null;
  if (metodo === "point" && !terminalId) {
    return NextResponse.json(
      { error: "metodo=point requiere terminal_id (ver GET /api/partners/terminales)" },
      { status: 400 }
    );
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL no configurado" }, { status: 500 });
  }

  // Idempotencia por referencia del partner
  if (body.external_reference) {
    const { data: previo } = await admin
      .from("cobros")
      .select("id, estado, init_point, mp_preference_id, metodo, mp_order_id, terminal_id")
      .eq("negocio_id", negocioId)
      .eq("app_id", appId)
      .eq("external_reference", body.external_reference)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        cobro_id: previo.id,
        estado: previo.estado,
        metodo: previo.metodo,
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
      metodo,
      terminal_id: metodo === "point" ? terminalId : null,
    })
    .select("id")
    .single();

  if (errIns || !cobro) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo crear el cobro" }, { status: 500 });
  }

  if (metodo === "point") {
    // 2) Mandar la orden a cobrar a la terminal Point, external_reference =
    // id del cobro (igual criterio que la preferencia QR).
    try {
      const orden = await crearOrdenPoint(accessToken, {
        terminalId: terminalId!,
        monto,
        descripcion: body.descripcion ?? "Cobro",
        externalReference: cobro.id,
      });

      await admin
        .from("cobros")
        .update({ mp_order_id: orden.id, updated_at: new Date().toISOString() })
        .eq("id", cobro.id);

      return NextResponse.json({
        cobro_id: cobro.id,
        estado: "pendiente",
        metodo: "point",
        order_id: orden.id,
      });
    } catch (e) {
      await admin
        .from("cobros")
        .update({ estado: "cancelado", updated_at: new Date().toISOString() })
        .eq("id", cobro.id);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No se pudo crear la orden en la terminal Point" },
        { status: 502 }
      );
    }
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
      metodo: "qr",
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
