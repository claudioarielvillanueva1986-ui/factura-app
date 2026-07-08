import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { emitirFacturaARCA } from "@/lib/arca";

export const runtime = "nodejs";
export const maxDuration = 26; // WSAA + WSFE son lentos; límite de Netlify Functions

// Reintenta la emisión de facturas que quedaron en estado 'error'. El polling
// filtra los pagos ya facturados, así que las facturas en error (que ya tienen
// fila) nunca se reintentaban solas: esta corrida las vuelve a empujar a ARCA.
// Reusa emitirFacturaARCA, así hereda el claim atómico, el cache de TA de WSAA
// y el log del error crudo (logArcaRaw) para diagnóstico.
// La dispara pg_cron / la Scheduled Function con el header x-cron-secret.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provisto = request.headers.get("x-cron-secret");
  if (!secret || provisto !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // Tope bajo por corrida: ARCA es lento y la función tiene ~26 s. Con corridas
  // frecuentes el backlog se drena en varias tandas.
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 3, 1), 8);
  const negocioId = searchParams.get("negocio_id");

  const admin = createSupabaseAdminClient();

  let query = admin
    .from("facturas")
    .select("id")
    .eq("estado", "error")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (negocioId) query = query.eq("negocio_id", negocioId);

  const { data: enError, error: errQuery } = await query;
  if (errQuery) {
    return NextResponse.json({ ok: false, error: errQuery.message }, { status: 500 });
  }

  const resultados: { id: string; ok: boolean; error?: string }[] = [];
  for (const f of enError ?? []) {
    const r = await emitirFacturaARCA(f.id as string);
    resultados.push({ id: f.id as string, ok: r.ok, error: r.error });
  }

  const emitidas = resultados.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    intentadas: resultados.length,
    emitidas,
    fallidas: resultados.length - emitidas,
    resultados,
  });
}
