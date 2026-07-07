import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";
import { generarPdfFactura } from "@/lib/pdfFactura";
import { formatoNumeroFactura } from "@/lib/types";

export const runtime = "nodejs";

const SELECT_FACTURA = `tipo, numero, fecha, subtotal, iva, total, cae, cae_vencimiento, estado, negocio_id,
       clientes(nombre, cuit_dni, condicion_iva),
       negocios(nombre, razon_social, cuit, punto_venta, condicion_iva, domicilio, iibb, inicio_actividades),
       factura_items(descripcion, cantidad, precio_unitario, subtotal)`;

// Genera el PDF del comprobante ya emitido. Dos formas de autenticarse:
//  - Sesión del usuario (uso normal desde el panel): RLS garantiza que solo
//    ve facturas de su negocio.
//  - Bearer token de partner con scope 'lectura' (la pdf_url que se comparte a
//    las apps del ecosistema): se valida que la factura sea del negocio del
//    token. Sin esto, cada pdf_url entregada a un partner sería un link muerto.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const tienePartnerBearer = /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");

  let factura:
    | Awaited<ReturnType<typeof cargarConSesion>>["factura"]
    | Awaited<ReturnType<typeof cargarConPartner>>["factura"] = null;
  let errorResp: NextResponse | null = null;

  if (tienePartnerBearer) {
    const r = await cargarConPartner(request, id);
    factura = r.factura;
    errorResp = r.errorResp;
  } else {
    const r = await cargarConSesion(id);
    factura = r.factura;
    errorResp = r.errorResp;
  }

  if (errorResp) return errorResp;
  if (!factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  if (!factura.cae || (factura.estado !== "emitida" && factura.estado !== "enviada")) {
    return NextResponse.json(
      { error: "La factura todavía no tiene CAE: emitila primero." },
      { status: 400 }
    );
  }

  const negocio = factura.negocios as unknown as Parameters<typeof generarPdfFactura>[0];
  const cliente = factura.clientes as unknown as Parameters<typeof generarPdfFactura>[1];
  const items = (factura.factura_items ?? []) as unknown as Parameters<typeof generarPdfFactura>[3];

  const pdfBytes = await generarPdfFactura(
    negocio,
    cliente,
    {
      tipo: factura.tipo as "A" | "B" | "C",
      numero: factura.numero,
      fecha: factura.fecha,
      subtotal: Number(factura.subtotal),
      iva: Number(factura.iva),
      total: Number(factura.total),
      cae: factura.cae,
      cae_vencimiento: factura.cae_vencimiento,
    },
    items
  );

  const nombreArchivo = `${formatoNumeroFactura(factura.tipo, factura.numero, negocio?.punto_venta ?? 1).replace(/\s+/g, "-")}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreArchivo}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

// Carga la factura con la sesión del usuario (RLS acota al propio negocio).
async function cargarConSesion(id: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { factura: null, errorResp: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  const { data: factura } = await supabase
    .from("facturas")
    .select(SELECT_FACTURA)
    .eq("id", id)
    .maybeSingle();
  return { factura, errorResp: null as NextResponse | null };
}

// Carga la factura autenticando por Bearer token de partner (scope 'lectura'),
// verificando que pertenezca al negocio del token.
async function cargarConPartner(request: NextRequest, id: string) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "lectura");
  if (!auth.ok) {
    return { factura: null, errorResp: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  }
  const { data: factura } = await admin
    .from("facturas")
    .select(SELECT_FACTURA)
    .eq("id", id)
    .eq("negocio_id", auth.ctx.negocioId)
    .maybeSingle();
  return { factura, errorResp: null as NextResponse | null };
}
