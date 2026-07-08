import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { cancelarPreapproval } from "@/lib/mpSuscripcion";
import { exigirAdminPlataforma } from "@/lib/authz";

export const runtime = "nodejs";

// Cancela la suscripción de un negocio (cuando el cliente pide que se le
// saque el cobro automático). Solo el admin de la plataforma puede hacerlo.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const authz = await exigirAdminPlataforma(supabase);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const body = (await request.json().catch(() => ({}))) as { negocio_id?: string };
  const negocio_id = body.negocio_id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!negocio_id || !UUID_RE.test(negocio_id)) {
    return NextResponse.json({ error: "negocio_id inválido" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: negocio } = await admin
    .from("negocios")
    .select("mp_preapproval_id")
    .eq("id", negocio_id)
    .maybeSingle();

  if (!negocio) {
    return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
  }

  if (negocio.mp_preapproval_id) {
    try {
      await cancelarPreapproval(negocio.mp_preapproval_id);
    } catch (error) {
      // Si ya estaba cancelada en MP (o nunca se autorizó del todo), no
      // bloqueamos la cancelación local por eso.
      console.warn("Cancelar preapproval en MP:", error);
    }
  }

  const { error: errUpd } = await admin
    .from("negocios")
    .update({
      estado_cuenta: "cancelado",
      suscripcion_cancelada_en: new Date().toISOString(),
    })
    .eq("id", negocio_id);

  if (errUpd) {
    return NextResponse.json({ error: "No se pudo cancelar la suscripción" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
