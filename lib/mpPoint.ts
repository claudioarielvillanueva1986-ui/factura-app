import { randomUUID } from "node:crypto";

// Cobro con terminal física Mercado Pago Point, vía la Orders API (la que MP
// recomienda para integraciones nuevas — la vieja "Payment Intents API" está
// en camino a discontinuarse). Usa el access_token OAuth del propio negocio,
// igual que crearPreferenciaCobro (Checkout Pro / QR) en mpCobros.ts.
//
// NOTA: esta integración no se pudo probar contra una terminal Point real
// desde este entorno (sin acceso de red a api.mercadopago.com ni a un
// dispositivo físico). Los nombres de campo están confirmados por la
// documentación pública de MP, pero conviene validar el flujo completo con
// un Point real antes de confiar en él en producción — si algún campo no
// coincide, el error de la API de MP debería ser suficientemente claro
// (se propaga tal cual en mensaje de error).

const MP_API = "https://api.mercadopago.com";

export interface TerminalPoint {
  id: string; // ej: "NEWLAND_N950__N950NCB801293324" — es el terminal_id a usar en config.point
  operating_mode?: string; // "STANDALONE" | "PDV"
  store_id?: string | null;
  pos_id?: number | null;
}

// Lista las terminales Point vinculadas a la cuenta MP del negocio, para que
// la app partner pueda ofrecerle al taller elegir en cuál cobrar.
export async function listarTerminalesPoint(accessToken: string): Promise<TerminalPoint[]> {
  const res = await fetch(`${MP_API}/point/integration-api/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP Point devices ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return (data.devices ?? []) as TerminalPoint[];
}

export interface OrdenPoint {
  id: string;
  type: "point";
  status?: string;
  external_reference?: string;
  transactions?: {
    payments?: { id?: string; status?: string; amount?: string }[];
  };
}

// Crea una orden de cobro y la manda a imprimir/cobrar en la terminal Point
// indicada. El pago lo termina de hacer el cliente pasando la tarjeta en el
// dispositivo físico del negocio; el resultado llega por webhook
// (type=order) o se puede consultar con obtenerOrdenPoint.
export async function crearOrdenPoint(
  accessToken: string,
  params: {
    terminalId: string;
    monto: number;
    descripcion?: string;
    externalReference: string;
    expiracion?: string; // duración ISO-8601, ej: "PT30M"
  }
): Promise<OrdenPoint> {
  const res = await fetch(`${MP_API}/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      type: "point",
      external_reference: params.externalReference,
      expiration_time: params.expiracion ?? "PT30M",
      description: params.descripcion || "Cobro",
      transactions: {
        payments: [{ amount: params.monto.toFixed(2) }],
      },
      config: {
        point: {
          terminal_id: params.terminalId,
          print_on_terminal: "no_ticket",
        },
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP Orders (point) ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data as OrdenPoint;
}

// Consulta el estado de una orden (reconciliación por webhook o polling de
// respaldo, igual criterio que sincronizarPreapproval en mpSuscripcion.ts).
export async function obtenerOrdenPoint(accessToken: string, orderId: string): Promise<OrdenPoint> {
  const res = await fetch(`${MP_API}/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP Orders (get) ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data as OrdenPoint;
}

// Cancela una orden Point pendiente (ej: el cliente se arrepintió o el
// cobro tardó demasiado). No falla si ya no se puede cancelar.
export async function cancelarOrdenPoint(accessToken: string, orderId: string): Promise<void> {
  await fetch(`${MP_API}/v1/orders/${orderId}/cancel`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": randomUUID(),
    },
  }).catch(() => {
    // best-effort
  });
}
