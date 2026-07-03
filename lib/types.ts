export type CondicionIvaNegocio = "monotributo" | "responsable_inscripto";
export type RolUsuario = "admin" | "operador";
export type EstadoFactura = "borrador" | "emitida" | "enviada" | "error";
export type TipoFactura = "A" | "B" | "C";

export interface Negocio {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string | null;
  condicion_iva: CondicionIvaNegocio;
  punto_venta: number;
  plan: string;
  trial_hasta: string | null;
}

export interface Usuario {
  id: string;
  negocio_id: string;
  nombre: string;
  rol: RolUsuario;
}

export interface Cliente {
  id: string;
  negocio_id: string;
  nombre: string;
  cuit_dni: string | null;
  email: string | null;
  telefono: string | null;
  condicion_iva: string;
}

export interface Factura {
  id: string;
  negocio_id: string;
  cliente_id: string | null;
  numero: number;
  tipo: TipoFactura;
  fecha: string;
  cae: string | null;
  cae_vencimiento: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estado: EstadoFactura;
  origen: string;
  mp_payment_id: string | null;
  wa_enviado: boolean;
  error_mensaje: string | null;
  created_at: string;
  clientes?: Pick<Cliente, "nombre" | "telefono" | "cuit_dni"> | null;
}

export interface FacturaItem {
  id: string;
  factura_id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface ResumenDashboard {
  total_hoy: number;
  total_mes: number;
  cantidad_mes: number;
  auto_mp: number;
  sin_enviar: number;
  semana: { dia: string; manual: number; auto_mp: number }[];
  ultimas: {
    id: string;
    numero: number;
    tipo: TipoFactura;
    fecha: string;
    total: number;
    estado: EstadoFactura;
    origen: string;
    wa_enviado: boolean;
    cliente_nombre: string;
  }[];
}

export function formatoNumeroFactura(tipo: string, numero: number, puntoVenta = 1) {
  return `FC-${tipo} ${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

export function formatoPesos(valor: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(valor ?? 0);
}

export function iniciales(nombre: string) {
  return (nombre || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
