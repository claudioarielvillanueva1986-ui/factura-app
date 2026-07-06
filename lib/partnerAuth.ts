import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Autenticación de la Partner API (ecosistema soft-a-soft).
//
// OAuth authorization-code: las apps externas (Soporte Móvil) obtienen un
// access_token vinculado a un negocio de facturá. Los tokens se guardan solo
// como hash SHA-256; el valor en claro se entrega una única vez. Todo corre
// con service_role (saltea RLS): las tablas partner_* no tienen políticas.
// ============================================================

export const SCOPES_VALIDOS = ["lectura", "facturacion", "cobros"] as const;
export type Scope = (typeof SCOPES_VALIDOS)[number];

const ACCESS_TTL_SEG = 3600; // 1 h
const REFRESH_TTL_DIAS = 180; // ~6 meses
const CODE_TTL_SEG = 300; // 5 min

export interface PartnerApp {
  id: string;
  nombre: string;
  client_id: string;
  client_secret_hash: string;
  redirect_uris: string[];
  scopes: string[];
  webhook_url: string | null;
  webhook_secret: string | null;
  activo: boolean;
}

export function sha256Hex(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function comparaConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Intersección de los scopes pedidos con los permitidos para la app.
export function filtrarScopes(app: PartnerApp, pedidos: string[]): Scope[] {
  const permitidos = new Set(app.scopes);
  return pedidos.filter(
    (s): s is Scope =>
      (SCOPES_VALIDOS as readonly string[]).includes(s) && permitidos.has(s)
  );
}

export async function appPorClientId(
  admin: SupabaseClient,
  clientId: string
): Promise<PartnerApp | null> {
  const { data } = await admin
    .from("partner_apps")
    .select("*")
    .eq("client_id", clientId)
    .eq("activo", true)
    .maybeSingle();
  return (data as PartnerApp) ?? null;
}

export function verificarClientSecret(app: PartnerApp, secret: string): boolean {
  return comparaConstante(app.client_secret_hash, sha256Hex(secret));
}

// ---------- Código de autorización (consentimiento aprobado) ----------
export async function crearCodigoAutorizacion(
  admin: SupabaseClient,
  params: {
    appId: string;
    negocioId: string;
    usuarioId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string | null;
  }
): Promise<string> {
  const code = tokenAleatorio(32);
  const { error } = await admin.from("partner_authorization_codes").insert({
    code_hash: sha256Hex(code),
    app_id: params.appId,
    negocio_id: params.negocioId,
    usuario_id: params.usuarioId,
    redirect_uri: params.redirectUri,
    scopes: params.scopes,
    code_challenge: params.codeChallenge ?? null,
    expira_en: new Date(Date.now() + CODE_TTL_SEG * 1000).toISOString(),
  });
  if (error) throw new Error(`No se pudo crear el código de autorización: ${error.message}`);
  return code;
}

export interface TokensPartner {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  negocio_id: string;
}

async function emitirGrant(
  admin: SupabaseClient,
  params: { appId: string; negocioId: string; scopes: string[] }
): Promise<TokensPartner> {
  const access = tokenAleatorio(32);
  const refresh = tokenAleatorio(32);
  const expiraEn = new Date(Date.now() + ACCESS_TTL_SEG * 1000).toISOString();

  const { error } = await admin.from("partner_grants").insert({
    app_id: params.appId,
    negocio_id: params.negocioId,
    access_token_hash: sha256Hex(access),
    refresh_token_hash: sha256Hex(refresh),
    scopes: params.scopes,
    expira_en: expiraEn,
  });
  if (error) throw new Error(`No se pudo emitir el grant: ${error.message}`);

  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEG,
    scope: params.scopes.join(" "),
    negocio_id: params.negocioId,
  };
}

// Canjea un authorization code por tokens. Valida app, redirect_uri,
// vencimiento, un solo uso y PKCE (si el authorize incluyó code_challenge).
export async function canjearCodigo(
  admin: SupabaseClient,
  params: { app: PartnerApp; code: string; redirectUri: string; codeVerifier?: string }
): Promise<TokensPartner> {
  const { data: fila } = await admin
    .from("partner_authorization_codes")
    .select("*")
    .eq("code_hash", sha256Hex(params.code))
    .maybeSingle();

  if (!fila) throw new Error("Código inválido");
  if (fila.usado) throw new Error("El código ya fue utilizado");
  if (fila.app_id !== params.app.id) throw new Error("El código no pertenece a esta aplicación");
  if (new Date(fila.expira_en).getTime() < Date.now()) throw new Error("El código expiró");
  if (fila.redirect_uri !== params.redirectUri) throw new Error("redirect_uri no coincide");

  if (fila.code_challenge) {
    if (!params.codeVerifier) throw new Error("Falta code_verifier (PKCE)");
    const challenge = createHash("sha256").update(params.codeVerifier).digest("base64url");
    if (!comparaConstante(fila.code_challenge, challenge)) {
      throw new Error("code_verifier inválido (PKCE)");
    }
  }

  // Marca el código como usado (un solo uso)
  await admin
    .from("partner_authorization_codes")
    .update({ usado: true })
    .eq("code_hash", fila.code_hash);

  return emitirGrant(admin, {
    appId: params.app.id,
    negocioId: fila.negocio_id,
    scopes: fila.scopes,
  });
}

// Rota el refresh_token: revoca el grant viejo y emite uno nuevo.
export async function rotarRefreshToken(
  admin: SupabaseClient,
  params: { app: PartnerApp; refreshToken: string }
): Promise<TokensPartner> {
  const { data: grant } = await admin
    .from("partner_grants")
    .select("*")
    .eq("refresh_token_hash", sha256Hex(params.refreshToken))
    .maybeSingle();

  if (!grant) throw new Error("refresh_token inválido");
  if (grant.app_id !== params.app.id) throw new Error("El token no pertenece a esta aplicación");
  if (grant.revocado) throw new Error("El token fue revocado");

  // Revoca el grant actual y emite uno nuevo (rotación)
  await admin.from("partner_grants").update({ revocado: true }).eq("id", grant.id);

  return emitirGrant(admin, {
    appId: grant.app_id,
    negocioId: grant.negocio_id,
    scopes: grant.scopes,
  });
}

// ---------- Validación de requests entrantes ----------
export interface ContextoPartner {
  appId: string;
  negocioId: string;
  scopes: string[];
}

type ResultadoPartner =
  | { ok: true; ctx: ContextoPartner }
  | { ok: false; status: number; error: string };

// Valida el header Authorization: Bearer <access_token> y, si se pide, que el
// grant tenga el scope requerido. Actualiza ultimo_uso_en.
export async function autenticarPartner(
  admin: SupabaseClient,
  request: NextRequest,
  scopeRequerido?: Scope
): Promise<ResultadoPartner> {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: "Falta el token Bearer" };

  const { data: grant } = await admin
    .from("partner_grants")
    .select("id, app_id, negocio_id, scopes, expira_en, revocado")
    .eq("access_token_hash", sha256Hex(m[1].trim()))
    .maybeSingle();

  if (!grant || grant.revocado) {
    return { ok: false, status: 401, error: "Token inválido o revocado" };
  }
  if (grant.expira_en && new Date(grant.expira_en).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "Token expirado" };
  }
  if (scopeRequerido && !grant.scopes.includes(scopeRequerido)) {
    return { ok: false, status: 403, error: `El token no tiene el permiso '${scopeRequerido}'` };
  }

  await admin
    .from("partner_grants")
    .update({ ultimo_uso_en: new Date().toISOString() })
    .eq("id", grant.id);

  return {
    ok: true,
    ctx: { appId: grant.app_id, negocioId: grant.negocio_id, scopes: grant.scopes },
  };
}

export const CONFIG_PARTNER = { ACCESS_TTL_SEG, REFRESH_TTL_DIAS, CODE_TTL_SEG };
