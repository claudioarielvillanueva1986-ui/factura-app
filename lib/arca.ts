import { Afip } from "afip.ts";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

// Mapeo de tipo de factura → código de comprobante WSFE
const CODIGO_COMPROBANTE: Record<string, number> = { A: 1, B: 6, C: 11 };

// Errores comunes de ARCA en formato amigable
const ERRORES_ARCA: { patron: RegExp; mensaje: string }[] = [
  {
    patron: /certificado|certificate|cms|firma|sign|expirado|expired/i,
    mensaje:
      "Certificado inválido o vencido. Andá a Configuración → ARCA y regenerá el certificado: " +
      "generá un CSR nuevo, subilo a ARCA y volvé a cargar el .crt.",
  },
  {
    patron: /punto de venta|ptovta|pto\.? vta/i,
    mensaje:
      "Punto de venta no habilitado para facturación electrónica. Habilitalo en " +
      "https://serviciosweb.afip.gob.ar → Administración de puntos de venta y domicilios " +
      "(elegí 'RECE para aplicativo y web services').",
  },
  {
    patron: /no autorizado|not authorized|computador|wsfe.*autoriz|delegaci/i,
    mensaje:
      "Tu CUIT no está autorizado para usar el web service de facturación (WSFE). " +
      "Entrá a ARCA → Administrador de Relaciones de Clave Fiscal → Nueva relación → " +
      "Web Services → Facturación Electrónica, y asociá tu certificado.",
  },
  {
    patron: /token|ta\.xml|login|wsaa/i,
    mensaje:
      "Error de autenticación con ARCA (WSAA). Suele resolverse reintentando en unos minutos. " +
      "Si persiste, revisá que el certificado esté asociado al servicio 'wsfe'.",
  },
];

export function mensajeErrorARCA(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  const conocido = ERRORES_ARCA.find((e) => e.patron.test(texto));
  if (conocido) return conocido.mensaje;
  return `Error de ARCA: ${texto}`;
}

function fechaWSFE(fecha: string) {
  // "2026-07-03" → "20260703"
  return fecha.replaceAll("-", "");
}

function parseFechaCAE(caeFchVto: string): string | null {
  // "20260713" → "2026-07-13"
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(caeFchVto ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface ResultadoEmision {
  ok: boolean;
  cae?: string;
  cae_vencimiento?: string | null;
  numero?: number;
  error?: string;
}

// Emite una factura existente (en borrador) contra WSFE de ARCA/AFIP.
// Corre solo en servidor: lee credenciales con service_role y actualiza estado.
export async function emitirFacturaARCA(facturaId: string): Promise<ResultadoEmision> {
  const admin = createSupabaseAdminClient();

  const { data: factura, error: errFactura } = await admin
    .from("facturas")
    .select("*, clientes(nombre, cuit_dni), negocios(id, cuit, punto_venta, condicion_iva)")
    .eq("id", facturaId)
    .single();

  if (errFactura || !factura) {
    return { ok: false, error: "Factura no encontrada" };
  }
  if (factura.estado === "emitida" || factura.estado === "enviada") {
    return {
      ok: true,
      cae: factura.cae,
      cae_vencimiento: factura.cae_vencimiento,
      numero: factura.numero,
    };
  }

  const negocio = factura.negocios;
  if (!negocio?.cuit) {
    return await marcarError(admin, facturaId, "Configurá el CUIT del negocio en Configuración antes de emitir.");
  }

  const { data: cred } = await admin
    .from("arca_credenciales")
    .select("key_pem, cert_pem")
    .eq("negocio_id", negocio.id)
    .maybeSingle();

  if (!cred?.key_pem || !cred?.cert_pem) {
    return await marcarError(
      admin,
      facturaId,
      "Faltan las credenciales de ARCA. Completá el asistente en Configuración → ARCA."
    );
  }

  try {
    const production = process.env.AFIP_MODE === "production";
    const afip = new Afip({
      key: cred.key_pem,
      cert: cred.cert_pem,
      cuit: Number(String(negocio.cuit).replace(/[^\d]/g, "")),
      production,
      // Serverless: el único filesystem escribible en Netlify Functions es /tmp
      ticketPath: "/tmp",
    });

    const cbteTipo = CODIGO_COMPROBANTE[factura.tipo];
    const cuitDni = (factura.clientes?.cuit_dni ?? "").replace(/[^\d]/g, "");
    // 80 = CUIT, 96 = DNI, 99 = consumidor final
    const docTipo = cuitDni.length === 11 ? 80 : cuitDni.length >= 7 ? 96 : 99;
    const docNro = docTipo === 99 ? 0 : Number(cuitDni);

    const esA = factura.tipo === "A";
    const impNeto = esA ? Number(factura.subtotal) : Number(factura.total);
    const impIVA = esA ? Number(factura.iva) : 0;

    // Número real según AFIP (puede diferir del provisorio local si se
    // emitieron comprobantes por fuera de la app)
    const puntoVenta = negocio.punto_venta ?? 1;
    const ultimo = await afip.electronicBillingService.getLastVoucher(puntoVenta, cbteTipo);
    const numeroAfip = Number(ultimo.CbteNro) + 1;

    const resultado = await afip.electronicBillingService.createVoucher({
      CantReg: 1,
      PtoVta: puntoVenta,
      CbteTipo: cbteTipo,
      CbteDesde: numeroAfip,
      CbteHasta: numeroAfip,
      Concepto: 1, // Productos
      DocTipo: docTipo,
      DocNro: docNro,
      CbteFch: fechaWSFE(factura.fecha),
      ImpTotal: Number(factura.total),
      ImpTotConc: 0,
      ImpNeto: impNeto,
      ImpOpEx: 0,
      ImpIVA: impIVA,
      ImpTrib: 0,
      MonId: "PES",
      MonCotiz: 1,
      ...(esA
        ? {
            Iva: [
              { Id: 5, BaseImp: Number(factura.subtotal), Importe: Number(factura.iva) }, // 5 = 21%
            ],
          }
        : {}),
    });

    if (!resultado.cae) {
      const detalle = JSON.stringify(resultado.response ?? {});
      return await marcarError(admin, facturaId, mensajeErrorARCA(detalle));
    }

    const caeVencimiento = parseFechaCAE(resultado.caeFchVto);

    await admin
      .from("facturas")
      .update({
        cae: resultado.cae,
        cae_vencimiento: caeVencimiento,
        estado: "emitida",
        error_mensaje: null,
        numero: numeroAfip,
      })
      .eq("id", facturaId);

    return {
      ok: true,
      cae: resultado.cae,
      cae_vencimiento: caeVencimiento,
      numero: numeroAfip,
    };
  } catch (error) {
    return await marcarError(admin, facturaId, mensajeErrorARCA(error));
  }
}

async function marcarError(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  facturaId: string,
  mensaje: string
): Promise<ResultadoEmision> {
  await admin
    .from("facturas")
    .update({ estado: "error", error_mensaje: mensaje })
    .eq("id", facturaId);
  return { ok: false, error: mensaje };
}
