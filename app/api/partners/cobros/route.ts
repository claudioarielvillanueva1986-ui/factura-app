import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { obtenerAccessTokenMP } from "@/lib/mp";
import { crearPreferenciaCobro } from "@/lib/mpCobros";
import { crearOrdenPoint, cambiarModoPoint } from "@/lib/mpPoint";
import { asegurarStorePos, crearQRDinamico } from "@/lib/mpQr";
import { consumirRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface Body {
  monto?: number;
  descripcion?: string;
  external_reference?: string; // referencia propia del partner (idempotencia)
  facturar?: boolean; // default true: al aprobarse el pago, se factura y emite
  metodo?: "qr" | "point" | "qr_dinamico"; // default "qr" (link/QR de Checkout Pro)
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

  const metodo = body.metodo === "point" ? "point" : body.metodo === "qr_dinamico" ? "qr_dinamico" : "qr";
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
      .select("id, estado, init_point, mp_preference_id, metodo, mp_order_id, terminal_id, qr_data")
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
        qr_data: previo.qr_data,
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
      // Automático: la terminal debe estar en modo PDV (integrada) para
      // recibir la orden. La activamos sin que el partner tenga que
      // configurar nada en Mercado Pago. Best-effort: si la terminal ya está
      // en PDV o el modelo no lo permite, dejamos que sea el intento de cobro
      // el que devuelva el error real de MP.
      try {
        await cambiarModoPoint(accessToken, terminalId!, "PDV");
      } catch {
        /* se intenta cobrar igual; si de verdad no está lista, falla abajo */
      }

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

  if (metodo === "qr_dinamico") {
    // 2) QR real de Mercado Pago (Dynamic QR Model) — a diferencia del QR de
    // Checkout Pro (metodo="qr"), este SÍ lo reconoce el lector de la app de
    // MP. Requiere Tienda + Caja dadas de alta (se crean solas la primera vez).
    try {
      const { data: config } = await admin
        .from("mercadopago_config")
        .select("mp_user_id")
        .eq("negocio_id", negocioId)
        .maybeSingle();
      if (!config?.mp_user_id) {
        throw new Error("El negocio no tiene Mercado Pago conectado en facturá.");
      }
      const { data: negocio } = await admin
        .from("negocios")
        .select("nombre")
        .eq("id", negocioId)
        .maybeSingle();

      const { posExternalId } = await asegurarStorePos(
        admin,
        accessToken,
        negocioId,
        config.mp_user_id,
        negocio?.nombre ?? "Local"
      );

      const orden = await crearQRDinamico(accessToken, {
        mpUserId: config.mp_user_id,
        posExternalId,
        monto,
        descripcion: body.descripcion ?? "Cobro",
        externalReference: cobro.id,
        notificationUrl: `${appUrl}/api/mp/webhook`,
      });

      await admin
        .from("cobros")
        .update({
          merchant_order_id: orden.in_store_order_id,
          qr_data: orden.qr_data,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cobro.id);

      return NextResponse.json({
        cobro_id: cobro.id,
        estado: "pendiente",
        metodo: "qr_dinamico",
        qr_data: orden.qr_data,
      });
    } catch (e) {
      await admin
        .from("cobros")
        .update({ estado: "cancelado", updated_at: new Date().toISOString() })
        .eq("id", cobro.id);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No se pudo generar el QR dinámico" },
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
