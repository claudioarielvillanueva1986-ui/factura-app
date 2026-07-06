import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  appPorClientId,
  verificarClientSecret,
  canjearCodigo,
  rotarRefreshToken,
} from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Token endpoint OAuth. Acepta JSON o x-www-form-urlencoded.
//   grant_type=authorization_code: client_id, client_secret, code, redirect_uri, [code_verifier]
//   grant_type=refresh_token:      client_id, client_secret, refresh_token
async function leerBody(request: NextRequest): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }
  const form = await request.formData();
  const obj: Record<string, string> = {};
  form.forEach((v, k) => (obj[k] = String(v)));
  return obj;
}

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await leerBody(request);
  } catch {
    return err("invalid_request");
  }

  const admin = createSupabaseAdminClient();
  const app = await appPorClientId(admin, body.client_id ?? "");
  if (!app) return err("invalid_client", 401);
  if (!body.client_secret || !verificarClientSecret(app, body.client_secret)) {
    return err("invalid_client", 401);
  }

  try {
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.redirect_uri) return err("invalid_request");
      const tokens = await canjearCodigo(admin, {
        app,
        code: body.code,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
      });
      return NextResponse.json(tokens, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return err("invalid_request");
      const tokens = await rotarRefreshToken(admin, {
        app,
        refreshToken: body.refresh_token,
      });
      return NextResponse.json(tokens, { headers: { "Cache-Control": "no-store" } });
    }

    return err("unsupported_grant_type");
  } catch (e) {
    return err(e instanceof Error ? e.message : "invalid_grant", 400);
  }
}
