import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { emitirFacturaARCA } from "@/lib/arca";
import { consumirRateLimit } from "@/lib/rateLimit";

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

  // Rate limit de emisión: cada llamada crea/emite un comprobante fiscal real
  // en ARCA. Ráfaga por minuto + tope diario por negocio, para acotar el daño
  // de un partner comprometido o con un bug en loop.
  for (const [clave, limite, ventana] of [
    [`facturas:min:${auth.ctx.negocioId}`, 30, 60],
    [`facturas:dia:${auth.ctx.negocioId}`, 300, 86400],
  ] as const) {
    const rl = await consumirRateLimit(admin, clave, limite, ventana);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Límite de emisión alcanzado, probá más tarde.", reset_en: rl.resetEn },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeg ?? 60) } }
      );
    }
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "La factura necesita al menos un ítem" }, { status: 400 });
  }
  if (body.items.length > 100) {
    return NextResponse.json({ error: "Demasiados ítems (máximo 100)" }, { status: 400 });
  }

  // Validar los ítems acá (y no dejar que reviente el cast en el RPC) evita a
  // la vez filtrar errores internos de Postgres y facturar basura.
  for (const [i, it] of body.items.entries()) {
    const item = it as { descripcion?: unknown; cantidad?: unknown; precio_unitario?: unknown };
    const cantidad = Number(item.cantidad);
    const precio = Number(item.precio_unitario);
    if (typeof item.descripcion !== "string" || item.descripcion.trim() === "") {
      return NextResponse.json({ error: `Ítem ${i + 1}: descripción inválida` }, { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return NextResponse.json({ error: `Ítem ${i + 1}: cantidad inválida` }, { status: 400 });
    }
    if (!Number.isFinite(precio) || precio < 0) {
      return NextResponse.json({ error: `Ítem ${i + 1}: precio unitario inválido` }, { status: 400 });
    }
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
