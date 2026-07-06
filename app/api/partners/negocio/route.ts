import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autenticarPartner } from "@/lib/partnerAuth";

export const runtime = "nodejs";

// Estado del negocio vinculado: datos fiscales + si ARCA y Mercado Pago están
// listos para operar. La app externa lo usa para decidir si puede facturar /
// cobrar o si tiene que mandar al taller a terminar la config en facturá.
export async function GET(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  const auth = await autenticarPartner(admin, request, "lectura");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { negocioId } = auth.ctx;

  const [{ data: negocio }, { data: mp }, { data: habilitada }] = await Promise.all([
    admin
      .from("negocios")
      .select(
        "id, nombre, razon_social, cuit, condicion_iva, punto_venta, arca_modo, arca_verificado_en, estado_cuenta"
      )
      .eq("id", negocioId)
      .maybeSingle(),
    admin
      .from("mercadopago_config")
      .select("access_token, auto_facturar")
      .eq("negocio_id", negocioId)
      .maybeSingle(),
    admin.rpc("cuenta_habilitada_para_facturar", { p_negocio_id: negocioId }),
  ]);

  if (!negocio) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });

  return NextResponse.json({
    negocio: {
      id: negocio.id,
      nombre: negocio.nombre,
      razon_social: negocio.razon_social,
      cuit: negocio.cuit,
      condicion_iva: negocio.condicion_iva,
      punto_venta: negocio.punto_venta,
    },
    facturacion: {
      habilitada: !!habilitada,
      estado_cuenta: negocio.estado_cuenta,
      arca_conectado: !!negocio.arca_verificado_en,
      arca_modo: negocio.arca_modo,
    },
    cobros: {
      mp_conectado: !!mp?.access_token,
      auto_facturar: !!mp?.auto_facturar,
    },
  });
}
