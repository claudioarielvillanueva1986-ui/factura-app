import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enviarComprobantePorEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 26;

// Reenvía (o envía) el comprobante por email al cliente. Uso desde el panel:
// la sesión + RLS garantizan que la factura sea del negocio del usuario.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // RLS: si la factura no es del negocio del usuario, no aparece.
  const { data: factura } = await supabase
    .from("facturas")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  const r = await enviarComprobantePorEmail(id, { forzar: true });
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? "No se pudo enviar" }, { status: 422 });
  }
  if (!r.enviado) {
    return NextResponse.json({ ok: true, enviado: false, motivo: r.motivo }, { status: 200 });
  }
  return NextResponse.json({ ok: true, enviado: true });
}
