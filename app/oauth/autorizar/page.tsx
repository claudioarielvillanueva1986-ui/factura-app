import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { filtrarScopes, type PartnerApp } from "@/lib/partnerAuth";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Descripción legible de cada permiso que la app externa solicita.
const DESCRIPCION_SCOPE: Record<string, string> = {
  lectura: "Ver los datos fiscales de tu negocio (razón social, CUIT y estado de conexión).",
  facturacion: "Emitir facturas electrónicas en ARCA a tu nombre.",
  cobros: "Crear cobros de Mercado Pago en tu cuenta conectada.",
};

function CardError({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-surface p-6 text-center">
        <Logo size="text-2xl" />
        <h1 className="mt-4 text-[15px] font-semibold text-status-error">{titulo}</h1>
        <p className="mt-2 text-[13px] text-text-secondary">{detalle}</p>
      </div>
    </main>
  );
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AutorizarPage({ searchParams }: Props) {
  const sp = await searchParams;
  const val = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));

  const clientId = val("client_id");
  const redirectUri = val("redirect_uri");
  const responseType = val("response_type") ?? "code";
  const scopeRaw = val("scope") ?? "lectura";
  const state = val("state") ?? "";
  const codeChallenge = val("code_challenge") ?? "";

  if (!clientId || !redirectUri) {
    return <CardError titulo="Solicitud inválida" detalle="Faltan parámetros (client_id / redirect_uri)." />;
  }
  if (responseType !== "code") {
    return <CardError titulo="Solicitud inválida" detalle="Solo se admite response_type=code." />;
  }

  // Validar la app y la redirect_uri con service_role (partner_apps sin RLS).
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("partner_apps")
    .select("*")
    .eq("client_id", clientId)
    .eq("activo", true)
    .maybeSingle();
  const app = appRow as PartnerApp | null;

  if (!app) {
    return <CardError titulo="Aplicación desconocida" detalle="El client_id no corresponde a ninguna aplicación activa." />;
  }
  if (!app.redirect_uris.includes(redirectUri)) {
    return <CardError titulo="Redirección no permitida" detalle="La redirect_uri no está registrada para esta aplicación." />;
  }

  const scopes = filtrarScopes(app, scopeRaw.split(/[\s,]+/).filter(Boolean));
  if (scopes.length === 0) {
    return <CardError titulo="Permisos inválidos" detalle="Los permisos solicitados no son válidos para esta aplicación." />;
  }

  // Sesión de facturá. Si no hay, mandamos a login preservando el retorno.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const urlRetorno =
    "/oauth/autorizar?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
    }).toString();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[420px] rounded-card border border-line bg-surface p-6 text-center">
          <Logo size="text-2xl" />
          <h1 className="mt-4 text-[15px] font-semibold text-text-primary">
            Conectá {app.nombre} con facturá.
          </h1>
          <p className="mt-2 text-[13px] text-text-secondary">
            Iniciá sesión (o creá tu cuenta) en facturá. para autorizar la conexión.
          </p>
          <a
            href={`/login?next=${encodeURIComponent(urlRetorno)}`}
            className="mt-5 inline-flex w-full items-center justify-center rounded-btn bg-brand px-4 py-2.5 text-[13px] font-medium text-white hover:bg-brand-hover"
          >
            Ingresar a facturá.
          </a>
        </div>
      </main>
    );
  }

  // El usuario debe ser admin de su negocio para vincular integraciones.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id, nombre, rol")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuario?.negocio_id) {
    return <CardError titulo="Cuenta sin negocio" detalle="Completá el registro de tu negocio en facturá. antes de conectar aplicaciones." />;
  }
  if (usuario.rol !== "admin") {
    return <CardError titulo="Permisos insuficientes" detalle="Solo el administrador del negocio puede conectar aplicaciones externas." />;
  }

  const { data: negocio } = await supabase
    .from("negocios")
    .select("nombre, razon_social")
    .eq("id", usuario.negocio_id)
    .maybeSingle();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px] rounded-card border border-line bg-surface p-6">
        <div className="text-center">
          <Logo size="text-2xl" />
        </div>

        <h1 className="mt-5 text-center text-[16px] font-semibold text-text-primary">
          {app.nombre} quiere conectarse a tu cuenta
        </h1>
        <p className="mt-1 text-center text-[13px] text-text-secondary">
          Negocio: <strong className="text-text-primary">{negocio?.razon_social || negocio?.nombre}</strong>
        </p>

        <div className="mt-5 rounded-card border border-line bg-[#1A2235] p-4">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-text-secondary">
            Vas a permitir que {app.nombre} pueda:
          </p>
          <ul className="space-y-2.5">
            {scopes.map((s) => (
              <li key={s} className="flex gap-2 text-[13px] text-text-primary">
                <span className="mt-0.5 text-accent-light">✓</span>
                <span>{DESCRIPCION_SCOPE[s] ?? s}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-[12px] text-text-secondary">
          Los certificados de ARCA y los tokens de Mercado Pago nunca se comparten con {app.nombre}:
          quedan siempre en facturá. Podés revocar el acceso cuando quieras.
        </p>

        <form action="/api/oauth/aprobar" method="post" className="mt-5 space-y-2.5">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="scope" value={scopes.join(" ")} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <Button type="submit" name="decision" value="permitir" className="w-full py-2.5">
            Autorizar
          </Button>
          <Button type="submit" name="decision" value="cancelar" variant="ghost" className="w-full py-2.5">
            Cancelar
          </Button>
        </form>
      </div>
    </main>
  );
}
