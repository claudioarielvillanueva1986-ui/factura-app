import type { EstadoFactura } from "@/lib/types";

const ESTILOS: Record<EstadoFactura, string> = {
  borrador: "bg-slate-100 text-text-secondary",
  emitida: "bg-status-ok/15 text-status-ok",
  enviada: "bg-accent-dim text-accent-light",
  error: "bg-status-error/15 text-status-error",
};

const ETIQUETAS: Record<EstadoFactura, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  enviada: "Enviada",
  error: "Error",
};

export function EstadoBadge({
  estado,
  origen,
}: {
  estado: EstadoFactura;
  origen?: string;
}) {
  // Las facturas automáticas de Mercado Pago pisan el estilo del estado
  if (origen === "mercadopago") {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-dim px-2.5 py-0.5 text-[11px] font-medium text-brand-hover">
        ⚡ Auto MP
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${ESTILOS[estado]}`}
    >
      {ETIQUETAS[estado]}
    </span>
  );
}
