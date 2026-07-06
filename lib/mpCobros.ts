// Creación de cobros de Mercado Pago (Checkout Pro) para la Partner API.
// facturá. hasta ahora solo INGERÍA pagos (auto-facturación); esto agrega la
// capacidad de INICIAR un cobro en nombre del negocio, usando su access_token
// conectado por OAuth. Devuelve un init_point (link/QR) universal, sin
// requerir configuración de tienda/POS.

const MP_API = "https://api.mercadopago.com";

export interface PreferenciaCobro {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
}

export async function crearPreferenciaCobro(
  accessToken: string,
  params: {
    monto: number;
    descripcion: string;
    externalReference: string;
    negocioId: string;
    appUrl: string;
  }
): Promise<PreferenciaCobro> {
  const notification_url = `${params.appUrl.replace(/\/$/, "")}/api/mp/webhook/${params.negocioId}`;

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      items: [
        {
          title: params.descripcion || "Cobro",
          quantity: 1,
          unit_price: Number(params.monto),
          currency_id: "ARS",
        },
      ],
      external_reference: params.externalReference,
      notification_url,
      binary_mode: true, // approved / rejected, sin estado "pending"
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `MP preferencia ${res.status}: ${data.message ?? data.error ?? JSON.stringify(data)}`
    );
  }
  return data as PreferenciaCobro;
}
