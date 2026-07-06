import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Valida la firma x-signature que Mercado Pago agrega a las notificaciones
// de webhook (algoritmo documentado: HMAC-SHA256 sobre un manifest con el
// id del recurso, el x-request-id y el timestamp). La "Clave secreta" se
// configura una única vez en el panel de la aplicación de MP → Webhooks, y
// se guarda en MP_WEBHOOK_SECRET.
//
// Si la env var no está configurada, no se bloquea la notificación (la
// mitigación principal —consultar el pago real contra la API de MP antes de
// facturar— sigue vigente), pero se loguea un aviso para que se complete la
// configuración.
export function verificarFirmaMP(request: NextRequest, dataId: string | null): boolean {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) {
    console.warn(
      "MP_WEBHOOK_SECRET no configurado: no se valida la firma del webhook de Mercado Pago."
    );
    return true;
  }

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  if (!xSignature || !xRequestId || !dataId) return false;

  const partes = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), v?.trim()];
    })
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  // MP exige el id en minúsculas cuando es alfanumérico
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const esperado = createHmac("sha256", secreto).update(manifest).digest("hex");

  const bufEsperado = Buffer.from(esperado, "hex");
  const bufRecibido = Buffer.from(v1, "hex");
  if (bufEsperado.length !== bufRecibido.length) return false;
  return timingSafeEqual(bufEsperado, bufRecibido);
}
