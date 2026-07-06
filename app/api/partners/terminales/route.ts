import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { obtenerAccessTokenMP } from "@/lib/mp";
import { listarTerminalesPoint } from "@/lib/mpPoint";

export const runtime = "nodejs";

// Lista las terminales Point vinculadas a la cuenta MP del negocio, para que
// la app partner le ofrezca al taller elegir en cuál cobrar (terminal_id de
// POST /api/partners/cobros con metodo="point").
export async function GET(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "cobros");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const accessToken = await obtenerAccessTokenMP(admin, auth.ctx.negocioId);
  if (!accessToken) {
    return NextResponse.json(
      { error: "El negocio no tiene Mercado Pago conectado en facturá." },
      { status: 409 }
    );
  }

  try {
    const terminales = await listarTerminalesPoint(accessToken);
    return NextResponse.json({ terminales });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudieron listar las terminales Point" },
      { status: 502 }
    );
  }
}
