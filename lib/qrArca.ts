import QRCode from "qrcode";
import { codigoComprobante, docTipoYNro } from "@/lib/arca";

interface DatosQr {
  fecha: string; // YYYY-MM-DD
  cuitEmisor: string;
  puntoVenta: number;
  tipo: "A" | "B" | "C";
  clase?: string | null; // factura / nota_credito / nota_debito
  numero: number;
  total: number;
  cuitDniReceptor?: string | null;
  cae: string;
}

// Genera el código QR obligatorio del comprobante (RG 4892/2020 de AFIP).
// El QR codifica una URL con un payload en base64; el lector oficial de
// ARCA decodifica ese payload para validar el comprobante.
export async function generarQrArcaDataUrl(datos: DatosQr): Promise<string> {
  const { docTipo, docNro } = docTipoYNro(datos.cuitDniReceptor);

  const payload = {
    ver: 1,
    fecha: datos.fecha,
    cuit: Number(String(datos.cuitEmisor).replace(/[^\d]/g, "")),
    ptoVta: datos.puntoVenta,
    tipoCmp: codigoComprobante(datos.clase, datos.tipo),
    nroCmp: datos.numero,
    importe: Number(datos.total),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: docTipo,
    nroDocRec: docNro,
    tipoCodAut: "E",
    codAut: Number(datos.cae),
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const url = `https://www.afip.gob.ar/fe/qr/?p=${base64}`;

  return QRCode.toDataURL(url, { margin: 0, width: 240 });
}
