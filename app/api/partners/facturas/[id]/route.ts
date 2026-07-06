import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Estado de una factura del negocio vinculado (para polling / reconciliación).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "lectura");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: factura } = await admin
    .from("facturas")
    .select("id, numero, tipo, fecha, cae, cae_vencimiento, subtotal, iva, total, estado, error_mensaje")
    .eq("id", id)
    .eq("negocio_id", auth.ctx.negocioId)
    .maybeSingle();

  if (!factura) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return NextResponse.json({
    factura,
    pdf_url: appUrl ? `${appUrl}/api/facturas/${factura.id}/pdf` : null,
  });
}
