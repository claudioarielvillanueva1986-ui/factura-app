import { supabase } from "@/lib/supabase";
import { formatoPesos } from "@/lib/types";

interface DatosComprobante {
  nombreCliente: string;
  tipo: string;
  numero: number;
  puntoVenta?: number;
  total: number;
  cae?: string | null;
  telefono?: string | null;
}

// Genera el link wa.me con el mensaje pre-armado del comprobante.
export function generarLinkWhatsApp(datos: DatosComprobante) {
  const numeroFmt = `${String(datos.puntoVenta ?? 1).padStart(4, "0")}-${String(
    datos.numero
  ).padStart(8, "0")}`;

  const mensaje =
    `✅ *Comprobante*\n\n` +
    `Hola ${datos.nombreCliente}, te enviamos tu comprobante:\n\n` +
    `📄 Factura ${datos.tipo} N° ${numeroFmt}\n` +
    `💰 Total: ${formatoPesos(datos.total)}\n` +
    `🔑 CAE: ${datos.cae ?? "-"}\n\n` +
    `Gracias por tu compra.`;

  const telefono = (datos.telefono ?? "").replace(/[^\d]/g, "");
  const base = telefono ? `https://wa.me/${telefono}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(mensaje)}`;
}

// Abre WhatsApp con el mensaje y marca la factura como enviada.
export async function enviarPorWhatsApp(facturaId: string, datos: DatosComprobante) {
  window.open(generarLinkWhatsApp(datos), "_blank", "noopener,noreferrer");

  const { error } = await supabase
    .from("facturas")
    .update({ wa_enviado: true, estado: "enviada" })
    .eq("id", facturaId);

  return { error };
}
