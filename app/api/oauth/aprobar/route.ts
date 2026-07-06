import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { appPorClientId, crearCodigoAutorizacion, filtrarScopes } from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Recibe el consentimiento del usuario (form POST desde /oauth/autorizar),
// mint del authorization code y redirect de vuelta a la app externa.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const scopeRaw = String(form.get("scope") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const decision = String(form.get("decision") ?? "cancelar");

  const admin = createSupabaseAdminClient();
  const app = await appPorClientId(admin, clientId);
  if (!app || !app.redirect_uris.includes(redirectUri)) {
    // No redirigimos a una URI no validada (anti open-redirect)
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const destino = new URL(redirectUri);
  if (state) destino.searchParams.set("state", state);

  if (decision !== "permitir") {
    destino.searchParams.set("error", "access_denied");
    return NextResponse.redirect(destino, { status: 303 });
  }

  // Re-verificar sesión y rol (no confiar en el render previo)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    destino.searchParams.set("error", "login_required");
    return NextResponse.redirect(destino, { status: 303 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id, rol")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuario?.negocio_id || usuario.rol !== "admin") {
    destino.searchParams.set("error", "access_denied");
    return NextResponse.redirect(destino, { status: 303 });
  }

  const scopes = filtrarScopes(app, scopeRaw.split(/[\s,]+/).filter(Boolean));
  if (scopes.length === 0) {
    destino.searchParams.set("error", "invalid_scope");
    return NextResponse.redirect(destino, { status: 303 });
  }

  try {
    const code = await crearCodigoAutorizacion(admin, {
      appId: app.id,
      negocioId: usuario.negocio_id,
      usuarioId: user.id,
      redirectUri,
      scopes,
      codeChallenge: codeChallenge || null,
    });
    destino.searchParams.set("code", code);
  } catch {
    destino.searchParams.set("error", "server_error");
  }

  return NextResponse.redirect(destino, { status: 303 });
}
