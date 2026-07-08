import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { obtenerAccessTokenMP } from "@/lib/mp";
import { listarTerminalesPoint, cambiarModoPoint } from "@/lib/mpPoint";

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

// Cambia el modo de operación de una terminal Point. Normalmente no hace falta
// llamarlo: POST /api/partners/cobros ya pone la terminal en PDV solo. Queda
// expuesto para que un sistema del ecosistema pueda controlarlo explícitamente
// (ej. devolver la terminal a STANDALONE para cobros manuales).
export async function PATCH(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "cobros");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { terminal_id?: string; modo?: string };
  try {
    body = (await request.json()) as { terminal_id?: string; modo?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const terminalId = body.terminal_id;
  const modo = body.modo ?? "PDV";
  if (!terminalId) {
    return NextResponse.json({ error: "Falta terminal_id" }, { status: 400 });
  }
  if (modo !== "PDV" && modo !== "STANDALONE") {
    return NextResponse.json({ error: "modo debe ser 'PDV' o 'STANDALONE'" }, { status: 400 });
  }

  const accessToken = await obtenerAccessTokenMP(admin, auth.ctx.negocioId);
  if (!accessToken) {
    return NextResponse.json(
      { error: "El negocio no tiene Mercado Pago conectado en facturá." },
      { status: 409 }
    );
  }

  try {
    await cambiarModoPoint(accessToken, terminalId, modo);
    return NextResponse.json({ terminal_id: terminalId, modo });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo cambiar el modo de la terminal" },
      { status: 502 }
    );
  }
}
