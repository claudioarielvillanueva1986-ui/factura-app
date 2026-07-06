import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { appPorClientId, verificarClientSecret } from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Habilita (o revoca) la cuenta de facturá. de un negocio vinculado, mientras
// el combo esté pago en el producto externo. Autenticación server-to-server
// por client credentials (NO un access_token de usuario): es una acción
// privilegiada que vale por el pago, no por una sesión del taller.
//
// body: { client_id, client_secret, negocio_id, hasta: "YYYY-MM-DD" }
//   - hasta futuro  => cuenta habilitada hasta esa fecha
//   - hasta pasado  => revoca el entitlement
export async function POST(request: NextRequest) {
  let body: Record<string, string>;
  try {
    body = (await request.json()) as Record<string, string>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const app = await appPorClientId(admin, body.client_id ?? "");
  if (!app || !body.client_secret || !verificarClientSecret(app, body.client_secret)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  if (!body.negocio_id || !body.hasta) {
    return NextResponse.json({ error: "Faltan negocio_id o hasta" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.hasta)) {
    return NextResponse.json({ error: "hasta debe ser YYYY-MM-DD" }, { status: 400 });
  }

  const { data, error } = await admin.rpc("partner_set_entitlement", {
    p_app_id: app.id,
    p_negocio_id: body.negocio_id,
    p_hasta: body.hasta,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ ok: data === true, negocio_id: body.negocio_id, entitled_hasta: body.hasta });
}
