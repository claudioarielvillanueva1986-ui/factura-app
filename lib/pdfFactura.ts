import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { generarQrArcaDataUrl } from "@/lib/qrArca";
import { formatoNumeroFactura, formatoPesos } from "@/lib/types";

export interface NegocioPdf {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  punto_venta: number;
  condicion_iva: "monotributo" | "responsable_inscripto";
  domicilio: string | null;
  iibb: string | null;
  inicio_actividades: string | null;
}

export interface ClientePdf {
  nombre: string;
  cuit_dni: string | null;
  condicion_iva: string;
}

export interface FacturaPdf {
  tipo: "A" | "B" | "C";
  numero: number;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  cae: string;
  cae_vencimiento: string | null;
}

export interface ItemPdf {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

const NEGRO = rgb(0.08, 0.09, 0.11);
const GRIS = rgb(0.42, 0.46, 0.52);
const GRIS_CLARO = rgb(0.85, 0.87, 0.9);
const BRAND = rgb(0.486, 0.227, 0.929); // #7C3AED

const M = 40; // margen
const ANCHO = 595.28;
const ALTO = 841.89;

function fechaLarga(iso: string | null) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const CONDICION_IVA_LABEL: Record<string, string> = {
  monotributo: "Monotributista",
  responsable_inscripto: "Responsable Inscripto",
  consumidor_final: "Consumidor Final",
  exento: "Exento",
};

function wrapText(font: PDFFont, texto: string, size: number, maxWidth: number): string[] {
  const palabras = texto.split(/\s+/);
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(prueba, size) > maxWidth && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}

// Genera el PDF del comprobante en formato oficial argentino: encabezado
// con datos del emisor y receptor, detalle de ítems, impuestos discriminados
// según el tipo de comprobante (RG AFIP + Ley 27.743 de Transparencia
// Fiscal), CAE con vencimiento y el QR obligatorio (RG 4892/2020).
export async function generarPdfFactura(
  negocio: NegocioPdf,
  cliente: ClientePdf | null,
  factura: FacturaPdf,
  items: ItemPdf[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  const nuevaPagina = () => {
    page = doc.addPage([ANCHO, ALTO]);
    y = ALTO - M;
  };

  const linea = (texto: string, opciones: {
    x?: number;
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    dy?: number;
  } = {}) => {
    const { x = M, size = 9, font = fontRegular, color = NEGRO, dy = 13 } = opciones;
    page.drawText(texto, { x, y, size, font, color });
    y -= dy;
  };

  const trazo = (yPos = y) => {
    page.drawLine({
      start: { x: M, y: yPos },
      end: { x: ANCHO - M, y: yPos },
      thickness: 0.75,
      color: GRIS_CLARO,
    });
  };

  // ---------- Encabezado: letra + título + datos del comprobante ----------
  const cajaLetraX = ANCHO / 2 - 18;
  page.drawRectangle({
    x: cajaLetraX,
    y: y - 34,
    width: 36,
    height: 36,
    borderColor: NEGRO,
    borderWidth: 1.2,
  });
  page.drawText(factura.tipo, {
    x: cajaLetraX + (factura.tipo === "A" ? 12 : 11),
    y: y - 26,
    size: 20,
    font: fontBold,
    color: NEGRO,
  });
  const codigo = { A: "01", B: "06", C: "11" }[factura.tipo];
  page.drawText(`Cód. ${codigo}`, {
    x: cajaLetraX - 2,
    y: y - 46,
    size: 7,
    font: fontRegular,
    color: GRIS,
  });

  page.drawText("FACTURA", { x: M, y: y - 4, size: 18, font: fontBold, color: NEGRO });
  page.drawText(negocio.nombre, { x: M, y: y - 22, size: 10, font: fontRegular, color: GRIS });

  const numeroFmt = formatoNumeroFactura(factura.tipo, factura.numero, negocio.punto_venta);
  const xDer = ANCHO - M - 210;
  page.drawText(`Comprobante: ${numeroFmt}`, {
    x: xDer,
    y: y - 4,
    size: 10,
    font: fontBold,
    color: NEGRO,
  });
  page.drawText(`Fecha de emisión: ${fechaLarga(factura.fecha)}`, {
    x: xDer,
    y: y - 18,
    size: 9,
    font: fontRegular,
    color: GRIS,
  });
  page.drawText(`CUIT: ${negocio.cuit ?? "-"}`, {
    x: xDer,
    y: y - 31,
    size: 9,
    font: fontRegular,
    color: GRIS,
  });

  y -= 60;
  trazo();
  y -= 16;

  // ---------- Datos del emisor ----------
  linea(negocio.razon_social || negocio.nombre, { font: fontBold, size: 10, dy: 13 });
  linea(`Domicilio comercial: ${negocio.domicilio || "-"}`, { color: GRIS });
  linea(
    `Condición frente al IVA: ${CONDICION_IVA_LABEL[negocio.condicion_iva] ?? negocio.condicion_iva}`,
    { color: GRIS }
  );
  linea(`Ingresos Brutos: ${negocio.iibb || "-"}`, { color: GRIS });
  linea(`Inicio de actividades: ${fechaLarga(negocio.inicio_actividades)}`, {
    color: GRIS,
    dy: 16,
  });

  trazo();
  y -= 16;

  // ---------- Datos del receptor ----------
  linea("Datos del cliente", { font: fontBold, size: 9.5, color: GRIS, dy: 14 });
  linea(`CUIT/DNI: ${cliente?.cuit_dni || "Consumidor Final"}`);
  linea(cliente?.nombre || "Consumidor Final", { font: fontBold });
  linea(
    `Condición frente al IVA: ${CONDICION_IVA_LABEL[cliente?.condicion_iva ?? "consumidor_final"] ?? "Consumidor Final"}`,
    { color: GRIS }
  );
  linea("Condición de venta: Contado", { color: GRIS, dy: 18 });

  trazo();
  y -= 18;

  // ---------- Tabla de ítems ----------
  const colDescX = M;
  const colSubtotalX = ANCHO - M - 70;
  const colPrecioX = colSubtotalX - 65;
  const colCantX = colPrecioX - 65;
  const anchoDesc = colCantX - colDescX - 10;

  const encabezadoTabla = () => {
    page.drawText("Descripción", { x: colDescX, y, size: 9, font: fontBold, color: GRIS });
    page.drawText("Cant.", { x: colCantX, y, size: 9, font: fontBold, color: GRIS });
    page.drawText("P. Unit.", { x: colPrecioX, y, size: 9, font: fontBold, color: GRIS });
    page.drawText("Subtotal", { x: colSubtotalX, y, size: 9, font: fontBold, color: GRIS });
    y -= 8;
    trazo();
    y -= 14;
  };
  encabezadoTabla();

  for (const item of items) {
    const lineasDesc = wrapText(fontRegular, item.descripcion, 9, anchoDesc);
    const alturaFila = lineasDesc.length * 12 + 6;

    if (y - alturaFila < 130) {
      nuevaPagina();
      encabezadoTabla();
    }

    const yInicioFila = y;
    lineasDesc.forEach((l, i) => {
      page.drawText(l, { x: colDescX, y: yInicioFila - i * 12, size: 9, font: fontRegular, color: NEGRO });
    });
    page.drawText(String(item.cantidad), {
      x: colCantX,
      y: yInicioFila,
      size: 9,
      font: fontRegular,
      color: NEGRO,
    });
    page.drawText(formatoPesos(item.precio_unitario), {
      x: colPrecioX,
      y: yInicioFila,
      size: 9,
      font: fontRegular,
      color: NEGRO,
    });
    page.drawText(formatoPesos(item.subtotal), {
      x: colSubtotalX,
      y: yInicioFila,
      size: 9,
      font: fontRegular,
      color: NEGRO,
    });
    y -= alturaFila;
  }

  if (y < 200) nuevaPagina();

  y -= 6;
  trazo();
  y -= 20;

  // ---------- Totales e impuestos (según tipo de comprobante) ----------
  const xValor = ANCHO - M - 140;
  const xEtiqueta = xValor - 140;

  const filaTotal = (etiqueta: string, valor: string, opts: { bold?: boolean; size?: number } = {}) => {
    const { bold = false, size = 10 } = opts;
    const font = bold ? fontBold : fontRegular;
    page.drawText(etiqueta, { x: xEtiqueta, y, size, font, color: bold ? NEGRO : GRIS });
    page.drawText(valor, { x: xValor, y, size, font, color: NEGRO });
    y -= bold ? 18 : 14;
  };

  if (factura.tipo === "A") {
    // Responsable Inscripto → Responsable Inscripto: IVA discriminado
    filaTotal("Importe Neto Gravado:", formatoPesos(factura.subtotal));
    filaTotal("IVA (21%):", formatoPesos(factura.iva));
    y -= 4;
    filaTotal("TOTAL:", formatoPesos(factura.total), { bold: true, size: 13 });
  } else if (factura.tipo === "B") {
    // Responsable Inscripto → Consumidor Final / exento: el IVA no se
    // discrimina en el total, pero la Ley 27.743 (Régimen de Transparencia
    // Fiscal al Consumidor) exige informar el impuesto contenido.
    const ivaContenido = factura.total - factura.total / 1.21;
    filaTotal("TOTAL:", formatoPesos(factura.total), { bold: true, size: 13 });
    y -= 2;
    const notaLineas = wrapText(
      fontRegular,
      `Régimen de Transparencia Fiscal al Consumidor (Ley 27.743): este comprobante contiene ` +
        `${formatoPesos(ivaContenido)} de IVA (21%).`,
      7.5,
      ANCHO - M * 2
    );
    notaLineas.forEach((l) => {
      page.drawText(l, { x: M, y, size: 7.5, font: fontRegular, color: GRIS });
      y -= 10;
    });
  } else {
    // Monotributo: no discrimina IVA (está incluido en la cuota mensual del
    // monotributista, no en cada operación)
    filaTotal("TOTAL:", formatoPesos(factura.total), { bold: true, size: 13 });
  }

  y -= 12;
  trazo();
  y -= 20;

  // ---------- CAE + QR ----------
  const qrDataUrl = await generarQrArcaDataUrl({
    fecha: factura.fecha,
    cuitEmisor: negocio.cuit ?? "",
    puntoVenta: negocio.punto_venta,
    tipo: factura.tipo,
    numero: factura.numero,
    total: factura.total,
    cuitDniReceptor: cliente?.cuit_dni,
    cae: factura.cae,
  });
  const qrPng = await doc.embedPng(qrDataUrl);
  const qrTam = 85;

  if (y - qrTam < M) nuevaPagina();

  page.drawImage(qrPng, { x: M, y: y - qrTam, width: qrTam, height: qrTam });

  const xCae = M + qrTam + 20;
  let yCae = y - 4;
  page.drawText("Comprobante Autorizado", {
    x: xCae,
    y: yCae,
    size: 10,
    font: fontBold,
    color: BRAND,
  });
  yCae -= 16;
  page.drawText(`CAE: ${factura.cae}`, { x: xCae, y: yCae, size: 9.5, font: fontRegular, color: NEGRO });
  yCae -= 14;
  page.drawText(`Vencimiento del CAE: ${fechaLarga(factura.cae_vencimiento)}`, {
    x: xCae,
    y: yCae,
    size: 9.5,
    font: fontRegular,
    color: NEGRO,
  });

  return doc.save();
}
