import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Estado de un cobro (polling): estado, pago y factura asociada si ya se emitió.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "cobros");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: cobro } = await admin
    .from("cobros")
    .select("id, external_reference, monto, descripcion, estado, mp_payment_id, init_point, factura_id, created_at")
    .eq("id", id)
    .eq("negocio_id", auth.ctx.negocioId)
    .maybeSingle();

  if (!cobro) return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let factura = null;
  if (cobro.factura_id) {
    const { data: fac } = await admin
      .from("facturas")
      .select("id, numero, tipo, cae, cae_vencimiento, total, estado")
      .eq("id", cobro.factura_id)
      .maybeSingle();
    if (fac) {
      factura = { ...fac, pdf_url: appUrl ? `${appUrl}/api/facturas/${fac.id}/pdf` : null };
    }
  }

  return NextResponse.json({ cobro, factura });
}
