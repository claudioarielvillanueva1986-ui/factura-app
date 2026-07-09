import type { SupabaseClient } from "@supabase/supabase-js";

// QR real de Mercado Pago (Dynamic QR Model), reconocido por el lector
// propio de la app de MP — a diferencia del link de Checkout Pro
// (crearPreferenciaCobro en mpCobros.ts), que la app rechaza con "esto no
// es para hacer pagos" si se escanea con su lector en vez de la cámara.
//
// NOTA: igual que mpPoint.ts, esta integración no se pudo probar contra la
// API real de Mercado Pago desde este entorno (sin acceso de red). Los
// nombres de campo están confirmados por la documentación pública de MP,
// pero conviene probarla con un cobro chico real antes de confiar en ella
// en producción — si algún campo no coincide, el error de la API de MP se
// propaga tal cual en el mensaje de error.

const MP_API = "https://api.mercadopago.com";

interface Direccion {
  calle: string;
  numero: string;
  ciudad: string;
  provincia: string;
}

interface StorePos {
  storeExternalId: string;
  posExternalId: string;
}

// Da de alta la Tienda + Caja (Store + POS) del negocio en su cuenta de MP
// si todavía no existen, y persiste los ids en mercadopago_config. Es
// idempotente: si ya están guardados, los devuelve sin llamar a la API.
export async function asegurarStorePos(
  admin: SupabaseClient,
  accessToken: string,
  negocioId: string,
  mpUserId: string,
  nombreNegocio: string
): Promise<StorePos> {
  const { data: config } = await admin
    .from("mercadopago_config")
    .select("store_external_id, pos_external_id, domicilio_calle, domicilio_numero, domicilio_ciudad, domicilio_provincia")
    .eq("negocio_id", negocioId)
    .maybeSingle();

  if (config?.store_external_id && config?.pos_external_id) {
    return { storeExternalId: config.store_external_id, posExternalId: config.pos_external_id };
  }

  const dir: Direccion | null =
    config?.domicilio_calle && config?.domicilio_numero && config?.domicilio_ciudad && config?.domicilio_provincia
      ? {
          calle: config.domicilio_calle,
          numero: config.domicilio_numero,
          ciudad: config.domicilio_ciudad,
          provincia: config.domicilio_provincia,
        }
      : null;

  if (!dir) {
    throw new Error(
      "Para cobrar con QR real hace falta cargar la dirección del local en Configuración → Mercado Pago (se usa una sola vez para dar de alta la Tienda en MP)."
    );
  }

  const storeExternalId = `FA${negocioId.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const posExternalId = `${storeExternalId}POS1`;

  const resStore = await fetch(`${MP_API}/users/${mpUserId}/stores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: nombreNegocio.slice(0, 60) || "Local",
      external_id: storeExternalId,
      location: {
        street_name: dir.calle,
        street_number: dir.numero,
        city_name: dir.ciudad,
        state_name: dir.provincia,
      },
    }),
  });
  const store = await resStore.json();
  if (!resStore.ok) {
    throw new Error(`MP Stores ${resStore.status}: ${store.message ?? JSON.stringify(store)}`);
  }

  const resPos = await fetch(`${MP_API}/pos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: "Caja principal",
      fixed_amount: false,
      store_id: store.id,
      external_id: posExternalId,
    }),
  });
  const pos = await resPos.json();
  if (!resPos.ok) {
    throw new Error(`MP POS ${resPos.status}: ${pos.message ?? JSON.stringify(pos)}`);
  }

  await admin
    .from("mercadopago_config")
    .update({ store_external_id: storeExternalId, pos_external_id: posExternalId })
    .eq("negocio_id", negocioId);

  return { storeExternalId, posExternalId };
}

export interface OrdenQR {
  qr_data: string;
  in_store_order_id: string;
}

// Crea el QR dinámico (vale para un único cobro, con monto fijo) en la Caja
// del negocio. La confirmación del pago llega por el webhook de "payment"
// que ya existe (procesarEventoMP en lib/mp.ts) — MP emite ese evento para
// cualquier pago aprobado sea cual sea el canal, y ya matchea por
// external_reference = cobros.id, así que no hace falta un webhook nuevo.
export async function crearQRDinamico(
  accessToken: string,
  params: {
    mpUserId: string;
    posExternalId: string;
    monto: number;
    descripcion: string;
    externalReference: string;
    notificationUrl: string;
  }
): Promise<OrdenQR> {
  const res = await fetch(
    `${MP_API}/instore/orders/qr/seller/collectors/${params.mpUserId}/pos/${params.posExternalId}/qrs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        external_reference: params.externalReference,
        title: params.descripcion,
        description: params.descripcion,
        notification_url: params.notificationUrl,
        total_amount: params.monto,
        items: [
          {
            title: params.descripcion,
            unit_price: params.monto,
            quantity: 1,
            unit_measure: "unit",
            total_amount: params.monto,
          },
        ],
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP QR dinámico ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data as OrdenQR;
}
