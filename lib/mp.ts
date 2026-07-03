import type { SupabaseClient } from "@supabase/supabase-js";
import { emitirFacturaARCA } from "@/lib/arca";

// Helpers de Mercado Pago (solo servidor): OAuth de marketplace con refresh
// automático y procesamiento de webhooks. Los tokens viven en
// mercadopago_config y se escriben siempre con service_role.

const MP_API = "https://api.mercadopago.com";

export interface TokensMP {
  access_token: string;
  refresh_token?: string;
  user_id?: number | string;
  public_key?: string;
  expires_in?: number; // segundos (MP: ~6 meses)
}

function credencialesApp() {
  const client_id = process.env.MP_CLIENT_ID;
  const client_secret = process.env.MP_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new Error("Faltan MP_CLIENT_ID / MP_CLIENT_SECRET en el entorno del servidor");
  }
  return { client_id, client_secret };
}

export function urlRedirectOAuth() {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("Falta NEXT_PUBLIC_APP_URL para armar el redirect de OAuth");
  return `${base.replace(/\/$/, "")}/api/mp/oauth/callback`;
}

async function pedirToken(body: Record<string, string>): Promise<TokensMP> {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credencialesApp(), ...body }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `MP OAuth ${res.status}: ${data.message ?? data.error ?? JSON.stringify(data)}`
    );
  }
  return data as TokensMP;
}

export function intercambiarCodigoMP(code: string, codeVerifier?: string) {
  return pedirToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: urlRedirectOAuth(),
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });
}

export function refrescarTokenMP(refreshToken: string) {
  return pedirToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function guardarTokensMP(
  admin: SupabaseClient,
  negocioId: string,
  tokens: TokensMP
) {
  const expiraEn = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { error } = await admin.from("mercadopago_config").upsert({
    negocio_id: negocioId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    mp_user_id: tokens.user_id != null ? String(tokens.user_id) : null,
    public_key: tokens.public_key ?? null,
    expira_en: expiraEn,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`No se pudieron guardar los tokens de MP: ${error.message}`);
}

// Devuelve un access_token válido para el negocio, refrescándolo si está por
// vencer (los tokens OAuth de MP duran ~6 meses y el refresh_token rota).
export async function obtenerAccessTokenMP(
  admin: SupabaseClient,
  negocioId: string
): Promise<string | null> {
  const { data: config } = await admin
    .from("mercadopago_config")
    .select("access_token, refresh_token, expira_en")
    .eq("negocio_id", negocioId)
    .maybeSingle();

  if (!config?.access_token) return null;

  const DIAS_MARGEN = 15;
  const porVencer =
    config.expira_en &&
    new Date(config.expira_en).getTime() - Date.now() < DIAS_MARGEN * 24 * 3600 * 1000;

  if (porVencer && config.refresh_token) {
    try {
      const tokens = await refrescarTokenMP(config.refresh_token);
      await guardarTokensMP(admin, negocioId, tokens);
      return tokens.access_token;
    } catch {
      // Si el refresh falla, intentamos con el token actual igual
    }
  }

  return config.access_token;
}

/* ==================== Procesamiento de webhooks ==================== */

export interface EventoMP {
  // Uno de los dos, según la ruta que recibió la notificación
  negocioId?: string;
  mpUserId?: string;
  tipo: string | null;
  paymentId: string | null;
  payload: Record<string, unknown>;
}

// Procesa una notificación de pago de MP: consulta el pago con el token del
// negocio (lo que además valida que la notificación sea legítima), crea la
// factura vía RPC idempotente y la emite en ARCA. Nunca lanza: siempre deja
// el resultado en mp_webhook_logs para debugging.
export async function procesarEventoMP(admin: SupabaseClient, evento: EventoMP) {
  let negocioId = evento.negocioId ?? null;

  const log = async (resultado: string, error?: string) => {
    await admin.from("mp_webhook_logs").insert({
      negocio_id: negocioId,
      payload: evento.payload,
      resultado,
      error: error ?? null,
    });
  };

  try {
    // Resolver el negocio por user_id de MP (webhook de plataforma)
    if (!negocioId && evento.mpUserId) {
      const { data } = await admin
        .from("mercadopago_config")
        .select("negocio_id")
        .eq("mp_user_id", evento.mpUserId)
        .maybeSingle();
      negocioId = data?.negocio_id ?? null;
    }

    if (!negocioId) {
      await log("ignorado: no se pudo resolver el negocio de la notificación");
      return;
    }

    if (evento.tipo !== "payment") {
      await log("ignorado: tipo distinto de payment");
      return;
    }

    if (!evento.paymentId) {
      await log("ignorado: sin payment id");
      return;
    }

    const { data: config } = await admin
      .from("mercadopago_config")
      .select("auto_facturar")
      .eq("negocio_id", negocioId)
      .maybeSingle();

    const accessToken = await obtenerAccessTokenMP(admin, negocioId);
    if (!accessToken) {
      await log("error", "Negocio sin cuenta de Mercado Pago conectada");
      return;
    }

    const mpRes = await fetch(`${MP_API}/v1/payments/${evento.paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mpRes.ok) {
      await log("error", `MP API respondió ${mpRes.status} al consultar el pago ${evento.paymentId}`);
      return;
    }

    const pago = (await mpRes.json()) as {
      id: number;
      status: string;
      transaction_amount: number;
      description?: string;
      payer?: { phone?: { area_code?: string; number?: string } };
    };

    if (pago.status !== "approved") {
      await log(`ignorado: pago ${evento.paymentId} con status ${pago.status}`);
      return;
    }

    if (!config?.auto_facturar) {
      await log("ignorado: auto_facturar desactivado");
      return;
    }

    // Idempotencia: si ya existe factura para este pago, no duplicar
    const { data: existente } = await admin
      .from("facturas")
      .select("id")
      .eq("negocio_id", negocioId)
      .eq("mp_payment_id", String(evento.paymentId))
      .maybeSingle();

    if (existente) {
      await log(`ignorado: pago ${evento.paymentId} ya facturado (${existente.id})`);
      return;
    }

    const telefono = pago.payer?.phone?.number
      ? `${pago.payer.phone.area_code ?? ""}${pago.payer.phone.number}`
      : null;

    const { data: factura, error: errRpc } = await admin.rpc("crear_factura_mp", {
      p_negocio_id: negocioId,
      p_payment_id: String(evento.paymentId),
      p_monto: pago.transaction_amount,
      p_descripcion: pago.description ?? `Pago Mercado Pago ${evento.paymentId}`,
      p_telefono_pagador: telefono,
    });

    if (errRpc) {
      await log("error", `crear_factura_mp: ${errRpc.message}`);
      return;
    }

    const facturaId = (factura as { id: string }).id;
    const emision = await emitirFacturaARCA(facturaId);

    await log(
      emision.ok
        ? `facturado: pago ${evento.paymentId} → factura ${facturaId} CAE ${emision.cae}` +
            (telefono ? " (pendiente envío WA)" : "")
        : `factura ${facturaId} creada pero falló la emisión`,
      emision.ok ? undefined : emision.error
    );
  } catch (error) {
    await log("error", error instanceof Error ? error.message : String(error));
  }
}
