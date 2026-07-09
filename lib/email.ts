import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { generarPdfFactura } from "@/lib/pdfFactura";
import { formatoNumeroFactura, formatoPesos } from "@/lib/types";

// Envío automático del comprobante por email al cliente, con los datos del
// local (emisor) y el PDF oficial adjunto. Usa la API REST de Resend por
// fetch (sin dependencia npm). Si no está configurado RESEND_API_KEY, no
// rompe nada: simplemente no envía (best-effort).
//
// Variables de entorno:
//   RESEND_API_KEY   — clave de la cuenta de Resend (obligatoria para enviar)
//   EMAIL_FROM       — dirección remitente verificada en Resend.
//                      Default: "onboarding@resend.dev" (solo para pruebas).

const RESEND_URL = "https://api.resend.com/emails";

const SELECT_FACTURA = `tipo, clase, numero, fecha, subtotal, iva, total, cae, cae_vencimiento, estado,
       email_enviado,
       clientes(nombre, cuit_dni, condicion_iva, email),
       negocios(nombre, razon_social, cuit, punto_venta, condicion_iva, domicilio, iibb, inicio_actividades, email_automatico),
       factura_items(descripcion, cantidad, precio_unitario, subtotal)`;

export interface ResultadoEmail {
  ok: boolean;
  enviado?: boolean;
  motivo?: string; // por qué no se envió (sin email, toggle off, ya enviado…)
  error?: string;
}

interface OpcionesEmail {
  // Reenvío manual desde el panel: ignora el toggle y el "ya enviado".
  forzar?: boolean;
}

function direccionRemitente() {
  return process.env.EMAIL_FROM?.trim() || "onboarding@resend.dev";
}

// "Kiosco El Sol" → From: Kiosco El Sol <comprobantes@dominio>. Se sanitiza el
// nombre para no romper el header (sin comillas ni saltos de línea).
function fromConNombre(nombre: string) {
  const limpio = nombre.replace(/["\r\n<>]/g, "").trim().slice(0, 60) || "facturá.";
  return `${limpio} <${direccionRemitente()}>`;
}

export async function enviarComprobantePorEmail(
  facturaId: string,
  opts: OpcionesEmail = {}
): Promise<ResultadoEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: true, enviado: false, motivo: "email no configurado (RESEND_API_KEY)" };
  }

  const admin = createSupabaseAdminClient();
  const { data: factura, error } = await admin
    .from("facturas")
    .select(SELECT_FACTURA)
    .eq("id", facturaId)
    .maybeSingle();

  if (error || !factura) return { ok: false, error: "Factura no encontrada" };

  if (!factura.cae || (factura.estado !== "emitida" && factura.estado !== "enviada")) {
    return { ok: true, enviado: false, motivo: "la factura todavía no tiene CAE" };
  }

  const negocio = factura.negocios as unknown as {
    nombre: string;
    razon_social: string | null;
    cuit: string | null;
    punto_venta: number;
    condicion_iva: "monotributo" | "responsable_inscripto";
    domicilio: string | null;
    iibb: string | null;
    inicio_actividades: string | null;
    email_automatico: boolean;
  };
  const cliente = factura.clientes as unknown as {
    nombre: string;
    cuit_dni: string | null;
    condicion_iva: string;
    email: string | null;
  } | null;

  if (!opts.forzar && !negocio.email_automatico) {
    return { ok: true, enviado: false, motivo: "envío automático desactivado" };
  }
  if (!opts.forzar && factura.email_enviado) {
    return { ok: true, enviado: false, motivo: "ya se había enviado" };
  }
  const destino = cliente?.email?.trim();
  if (!destino) {
    return { ok: true, enviado: false, motivo: "el cliente no tiene email cargado" };
  }

  const items = (factura.factura_items ?? []) as unknown as Parameters<typeof generarPdfFactura>[3];
  const numeroFmt = formatoNumeroFactura(factura.tipo, factura.numero, negocio.punto_venta ?? 1);

  let pdfBase64: string;
  try {
    const pdfBytes = await generarPdfFactura(
      negocio,
      cliente,
      {
        tipo: factura.tipo as "A" | "B" | "C",
        clase: (factura as { clase?: string | null }).clase,
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
    pdfBase64 = Buffer.from(pdfBytes).toString("base64");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo generar el PDF" };
  }

  const html = cuerpoHtml({
    negocioNombre: negocio.razon_social || negocio.nombre,
    cuit: negocio.cuit,
    clienteNombre: cliente?.nombre ?? "Cliente",
    numeroFmt,
    fecha: factura.fecha,
    total: Number(factura.total),
    cae: factura.cae,
  });

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromConNombre(negocio.nombre),
        to: [destino],
        subject: `Comprobante ${numeroFmt} · ${negocio.nombre}`,
        html,
        attachments: [
          { filename: `${numeroFmt.replace(/\s+/g, "-")}.pdf`, content: pdfBase64 },
        ],
      }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${detalle.slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red al enviar el email" };
  }

  await admin
    .from("facturas")
    .update({ email_enviado: true, email_enviado_en: new Date().toISOString() })
    .eq("id", facturaId);

  return { ok: true, enviado: true };
}

function cuerpoHtml(d: {
  negocioNombre: string;
  cuit: string | null;
  clienteNombre: string;
  numeroFmt: string;
  fecha: string;
  total: number;
  cae: string;
}) {
  const fecha = d.fecha.split("-").reverse().join("/");
  // Email simple e inline (los clientes de correo ignoran <style> externos).
  return `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#0b0f1a;border-radius:14px;padding:20px 24px;color:#fff">
      <div style="font-size:18px;font-weight:700">${escapar(d.negocioNombre)}</div>
      ${d.cuit ? `<div style="font-size:12px;color:#9aa4b2">CUIT ${escapar(d.cuit)}</div>` : ""}
    </div>
    <div style="background:#fff;border-radius:14px;padding:24px;margin-top:12px;border:1px solid #e6e8ec">
      <p style="margin:0 0 4px;font-size:15px">Hola ${escapar(d.clienteNombre)},</p>
      <p style="margin:0 0 18px;font-size:14px;color:#42464e">
        Te enviamos tu comprobante electrónico. Lo tenés también adjunto en PDF.
      </p>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280">Comprobante</td>
            <td style="padding:6px 0;text-align:right;font-weight:600">${escapar(d.numeroFmt)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Fecha</td>
            <td style="padding:6px 0;text-align:right">${fecha}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Total</td>
            <td style="padding:6px 0;text-align:right;font-weight:700">${formatoPesos(d.total)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">CAE</td>
            <td style="padding:6px 0;text-align:right;font-family:monospace">${escapar(d.cae)}</td></tr>
      </table>
    </div>
    <p style="text-align:center;font-size:11px;color:#9aa4b2;margin-top:16px">
      Comprobante emitido electrónicamente ante ARCA (ex AFIP).
    </p>
  </div>
</body></html>`;
}

function escapar(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
