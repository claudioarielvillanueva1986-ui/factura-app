import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresca la sesión y la deja disponible para server components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const esLogin = pathname.startsWith("/login");

  if (!user && !esLogin) {
    // Preservar el path + query string original (ej: los parámetros de
    // /oauth/autorizar?client_id=...) para que el login pueda volver ahí.
    const next = pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (user && esLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Protege todo excepto:
     * - _next (estáticos), favicon, assets
     * - /api/mp/webhook y /api/billing/webhook (Mercado Pago llama sin sesión)
     * - /api/oauth/token y /api/partners (server-to-server: se autentican
     *   con client_secret / Bearer token de partner, no con cookies)
     * - /oauth/autorizar (página pública: valida la sesión ella misma y
     *   muestra su propio flujo de login si hace falta, preservando los
     *   parámetros de la solicitud OAuth)
     * - /api/facturas/{id}/pdf (se autentica solo: sesión O Bearer de partner;
     *   la pdf_url se comparte a apps del ecosistema, que no tienen cookie)
     * Los endpoints de /api/arca validan sesión por su cuenta.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/mp/webhook|api/billing/webhook|api/oauth/token|api/partners|api/facturas/[^/]+/pdf|oauth/autorizar|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
