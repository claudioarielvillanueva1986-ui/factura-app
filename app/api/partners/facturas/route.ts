import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { emitirFacturaARCA } from "@/lib/arca";

export const runtime = "nodejs";
export const maxDuration = 26; // emisión ARCA (WSAA + WSFE)

interface Body {
  receptor?: {
    doc_tipo?: string;
    doc_nro?: string;
    nombre?: string;
    condicion_iva?: string;
    email?: string;
    telefono?: string;
  } | null;
  items?: { descripcion: string; cantidad?: number; precio_unitario: number }[];
  tipo?: "A" | "B" | "C" | null;
  emitir?: boolean; // default true: crea y emite en ARCA en un paso
}

// Crea una factura a nombre del negocio vinculado y —por defecto— la emite en
// ARCA, devolviendo CAE + URL del PDF. Reutiliza crear_factura_partner (mismo
// esquema fiscal, numeración serializada y gate de suscripción que el resto).
export async function POST(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "facturacion");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "La factura necesita al menos un ítem" }, { status: 400 });
  }

  const { data: facturaData, error: errRpc } = await admin.rpc("crear_factura_partner", {
    p_negocio_id: auth.ctx.negocioId,
    p_receptor: body.receptor ?? null,
    p_items: body.items,
    p_tipo: body.tipo ?? null,
    p_origen: "partner",
  });

  if (errRpc) {
    return NextResponse.json({ error: errRpc.message }, { status: 422 });
  }

  const factura = facturaData as { id: string; numero: number; tipo: string; total: number };
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const pdfUrl = appUrl ? `${appUrl}/api/facturas/${factura.id}/pdf` : null;

  // emitir=false permite crear el borrador sin emitir todavía
  if (body.emitir === false) {
    return NextResponse.json({
      factura: { id: factura.id, numero: factura.numero, tipo: factura.tipo, total: factura.total, estado: "borrador" },
      pdf_url: pdfUrl,
    });
  }

  const emision = await emitirFacturaARCA(factura.id);
  if (!emision.ok) {
    return NextResponse.json(
      {
        error: emision.error,
        factura: { id: factura.id, numero: factura.numero, tipo: factura.tipo, estado: "error" },
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    factura: {
      id: factura.id,
      numero: factura.numero,
      tipo: factura.tipo,
      total: factura.total,
      estado: "emitida",
      cae: emision.cae,
      cae_vencimiento: emision.cae_vencimiento ?? null,
    },
    pdf_url: pdfUrl,
  });
}
