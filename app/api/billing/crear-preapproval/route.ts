import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { crearPreapproval } from "@/lib/mpSuscripcion";
import { exigirAdmin } from "@/lib/authz";

export const runtime = "nodejs";

// Crea la suscripción recurrente del negocio hacia la plataforma y devuelve
// el init_point para que el cliente autorice el cobro en Mercado Pago.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const authz = await exigirAdmin(supabase, user.id);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const admin = createSupabaseAdminClient();
  const { data: negocio } = await admin
    .from("negocios")
    .select("id, precio_mensual")
    .eq("id", authz.usuario.negocio_id)
    .maybeSingle();
  if (!negocio) {
    return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
  }

  const { data: config } = await admin
    .from("configuracion_plataforma")
    .select("precio_mensual")
    .limit(1)
    .maybeSingle();

  const monto = negocio.precio_mensual ?? config?.precio_mensual ?? 9999;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  try {
    const preapproval = await crearPreapproval({
      negocioId: negocio.id,
      payerEmail: user.email!,
      monto: Number(monto),
      backUrl: `${appUrl}/configuracion?suscripcion=ok`,
    });

    await admin
      .from("negocios")
      .update({ mp_preapproval_id: preapproval.id })
      .eq("id", negocio.id);

    return NextResponse.json({ init_point: preapproval.init_point });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear la suscripción" },
      { status: 500 }
    );
  }
}
