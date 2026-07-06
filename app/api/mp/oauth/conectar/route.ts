import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { urlRedirectOAuth } from "@/lib/mp";
import { exigirAdmin } from "@/lib/authz";

export const runtime = "nodejs";

// Inicia el flujo OAuth de Mercado Pago: redirige a la pantalla de
// autorización de MP con state anti-CSRF y PKCE (S256). Solo el admin del
// negocio puede conectar/reconectar la cuenta.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));
  }

  const authz = await exigirAdmin(supabase, user.id);
  if (!authz.ok) {
    return NextResponse.redirect(
      new URL("/configuracion?mp_error=rol", process.env.NEXT_PUBLIC_APP_URL)
    );
  }

  const clientId = process.env.MP_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/configuracion?mp_error=config", process.env.NEXT_PUBLIC_APP_URL)
    );
  }

  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const url = new URL("https://auth.mercadopago.com.ar/authorization");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", urlRedirectOAuth());
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url);
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/api/mp/oauth",
    maxAge: 600,
  };
  response.cookies.set("mp_oauth_state", state, cookieOpts);
  response.cookies.set("mp_oauth_verifier", codeVerifier, cookieOpts);
  return response;
}
