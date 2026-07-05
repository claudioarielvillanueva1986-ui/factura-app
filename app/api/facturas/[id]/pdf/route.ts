import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generarPdfFactura } from "@/lib/pdfFactura";
import { formatoNumeroFactura } from "@/lib/types";

export const runtime = "nodejs";

// Genera el PDF del comprobante ya emitido. Usa el cliente con sesión del
// usuario (no service_role): RLS garantiza que solo puede pedir facturas de
// su propio negocio.
export async function GET(
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

  const { data: factura, error } = await supabase
    .from("facturas")
    .select(
      `tipo, numero, fecha, subtotal, iva, total, cae, cae_vencimiento, estado,
       clientes(nombre, cuit_dni, condicion_iva),
       negocios(nombre, razon_social, cuit, punto_venta, condicion_iva, domicilio, iibb, inicio_actividades),
       factura_items(descripcion, cantidad, precio_unitario, subtotal)`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !factura) {
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
