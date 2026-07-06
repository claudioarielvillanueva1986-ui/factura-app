import type { SupabaseClient } from "@supabase/supabase-js";

interface UsuarioAuth {
  negocio_id: string;
  rol: "admin" | "operador";
}

type ResultadoAuthz =
  | { ok: true; usuario: UsuarioAuth }
  | { ok: false; status: number; error: string };

// Exige que el usuario autenticado sea 'admin' de su negocio. Se usa en
// acciones sensibles (ARCA, Mercado Pago, configuración) que un operador no
// debería poder disparar. La autorización real sigue viviendo en RLS/grants
// de columna; esto evita que un operador ni siquiera llegue a intentarlo y
// da un mensaje de error claro en vez de un 500 de Postgres.
export async function exigirAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<ResultadoAuthz> {
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id, rol")
    .eq("id", userId)
    .maybeSingle();

  if (!usuario?.negocio_id) {
    return { ok: false, status: 400, error: "Usuario sin negocio" };
  }
  if (usuario.rol !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Esta acción requiere permisos de administrador del negocio.",
    };
  }
  return { ok: true, usuario: usuario as UsuarioAuth };
}

// Exige que el usuario sea admin de LA PLATAFORMA (no de un negocio en
// particular) — para el panel que gestiona todos los clientes de facturá.
export async function exigirAdminPlataforma(
  supabase: SupabaseClient
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data, error } = await supabase.rpc("es_admin_plataforma");
  if (error || !data) {
    return { ok: false, status: 403, error: "No autorizado" };
  }
  return { ok: true };
}
