import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { sincronizarPreapproval } from "@/lib/mpSuscripcion";

export const runtime = "nodejs";

// Consulta en vivo el estado de la suscripción del propio negocio contra
// Mercado Pago (por si el webhook no llegó) y actualiza estado_cuenta.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!usuario?.negocio_id) {
    return NextResponse.json({ error: "Usuario sin negocio" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: negocio } = await admin
    .from("negocios")
    .select("mp_preapproval_id")
    .eq("id", usuario.negocio_id)
    .maybeSingle();

  if (!negocio?.mp_preapproval_id) {
    return NextResponse.json({ error: "Todavía no activaste ninguna suscripción" }, { status: 400 });
  }

  try {
    await sincronizarPreapproval(admin, negocio.mp_preapproval_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo sincronizar" },
      { status: 500 }
    );
  }
}
