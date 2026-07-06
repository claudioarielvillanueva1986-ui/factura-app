import type { SupabaseClient } from "@supabase/supabase-js";

// Cobro recurrente de la SUSCRIPCIÓN de facturá. (el cliente le paga a la
// plataforma). Usa la cuenta propia de Mercado Pago de la plataforma
// (PLATAFORMA_MP_ACCESS_TOKEN) — es un token distinto y separado del que
// usan los negocios conectados por OAuth (lib/mp.ts), que es para que ELLOS
// cobren a SUS clientes.

const MP_API = "https://api.mercadopago.com";

function tokenPlataforma(): string {
  const token = process.env.PLATAFORMA_MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "La plataforma no tiene configurado PLATAFORMA_MP_ACCESS_TOKEN (cuenta propia de Mercado Pago para cobrar suscripciones)."
    );
  }
  return token;
}

export interface Preapproval {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  init_point?: string;
  payer_email?: string;
  auto_recurring?: { transaction_amount: number; frequency: number; frequency_type: string };
}

// Crea una suscripción (sin plan asociado, precio fijo mensual). Devuelve
// el init_point: la URL de checkout de MP donde el cliente autoriza el
// cobro recurrente.
export async function crearPreapproval(params: {
  negocioId: string;
  payerEmail: string;
  monto: number;
  backUrl: string;
}): Promise<Preapproval> {
  const res = await fetch(`${MP_API}/preapproval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenPlataforma()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Suscripción mensual facturá.",
      external_reference: params.negocioId,
      payer_email: params.payerEmail,
      back_url: params.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: params.monto,
        currency_id: "ARS",
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP Preapproval ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data as Preapproval;
}

export async function obtenerPreapproval(id: string): Promise<Preapproval> {
  const res = await fetch(`${MP_API}/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${tokenPlataforma()}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP Preapproval ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data as Preapproval;
}

// Cancela la suscripción del lado de Mercado Pago (deja de cobrar). Se usa
// cuando el cliente pide expresamente que se le saque el cobro automático,
// o desde el panel de administración.
export async function cancelarPreapproval(id: string): Promise<void> {
  const res = await fetch(`${MP_API}/preapproval/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokenPlataforma()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`MP Preapproval ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
}

// Sincroniza el estado local (negocios.estado_cuenta / mp_preapproval_id)
// con lo que MP tiene registrado. Se llama desde el webhook y también desde
// un botón de "sincronizar" en la UI (defensivo, por si se pierde un evento).
export async function sincronizarPreapproval(admin: SupabaseClient, preapprovalId: string) {
  const preapproval = await obtenerPreapproval(preapprovalId);
  const negocioId = (preapproval as unknown as { external_reference?: string }).external_reference;
  if (!negocioId) return;

  const nuevoEstado =
    preapproval.status === "authorized"
      ? "activo"
      : preapproval.status === "cancelled"
        ? "cancelado"
        : preapproval.status === "paused"
          ? "suspendido"
          : null; // 'pending' — todavía no autorizó, no tocar el estado actual

  const update: Record<string, unknown> = { mp_preapproval_id: preapprovalId };
  if (nuevoEstado) update.estado_cuenta = nuevoEstado;
  if (preapproval.status === "cancelled") update.suscripcion_cancelada_en = new Date().toISOString();

  await admin.from("negocios").update(update).eq("id", negocioId);
}
