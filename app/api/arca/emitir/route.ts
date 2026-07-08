import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { emitirFacturaARCA } from "@/lib/arca";

export const runtime = "nodejs";
export const maxDuration = 26; // WSAA + WSFE pueden tardar; límite de Netlify Functions

// Emite una factura en borrador contra ARCA (WSFE) y guarda el CAE.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { factura_id?: string };
  const factura_id = body.factura_id;
  if (!factura_id) {
    return NextResponse.json({ error: "Falta factura_id" }, { status: 400 });
  }

  // RLS: si la factura no es del negocio del usuario, no aparece
  const { data: factura } = await supabase
    .from("facturas")
    .select("id, estado")
    .eq("id", factura_id)
    .maybeSingle();

  if (!factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  const resultado = await emitirFacturaARCA(factura.id);

  // Pendiente por propagación de ARCA: no es un error, la factura quedó
  // guardada y se emite sola. Devolvemos 200 con la bandera para que el panel
  // muestre un aviso amable en vez de un error rojo.
  if (resultado.pendiente) {
    return NextResponse.json(
      { ok: false, pendiente: true, mensaje: resultado.error },
      { status: 200 }
    );
  }

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 422 });
  }

  return NextResponse.json(resultado);
}
