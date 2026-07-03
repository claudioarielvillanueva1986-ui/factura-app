import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { intercambiarCodigoMP, guardarTokensMP } from "@/lib/mp";

export const runtime = "nodejs";

// Vuelta del OAuth de Mercado Pago: canjea el code por los tokens del
// vendedor y los guarda (service_role) en mercadopago_config.
export async function GET(request: NextRequest) {
  const irA = (destino: string) =>
    NextResponse.redirect(new URL(destino, process.env.NEXT_PUBLIC_APP_URL));

  const limpiarCookies = (res: NextResponse) => {
    res.cookies.delete("mp_oauth_state");
    res.cookies.delete("mp_oauth_verifier");
    return res;
  };

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get("mp_oauth_state")?.value;
  const verifier = request.cookies.get("mp_oauth_verifier")?.value;

  if (!code || !state || !stateCookie || state !== stateCookie) {
    return limpiarCookies(irA("/configuracion?mp_error=state"));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return limpiarCookies(irA("/login"));

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!usuario?.negocio_id) return limpiarCookies(irA("/configuracion?mp_error=negocio"));

  try {
    const tokens = await intercambiarCodigoMP(code, verifier);
    const admin = createSupabaseAdminClient();
    await guardarTokensMP(admin, usuario.negocio_id, tokens);
    return limpiarCookies(irA("/configuracion?mp=conectado"));
  } catch (error) {
    console.error("MP OAuth callback:", error);
    return limpiarCookies(irA("/configuracion?mp_error=token"));
  }
}
