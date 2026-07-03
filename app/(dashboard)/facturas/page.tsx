"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { enviarPorWhatsApp } from "@/lib/whatsapp";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EstadoBadge } from "@/components/ui/EstadoBadge";
import { useAuth } from "@/lib/useAuth";
import {
  formatoPesos,
  formatoNumeroFactura,
  type Factura,
} from "@/lib/types";

type Filtro = "todas" | "auto_mp" | "sin_wa" | "borradores";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "auto_mp", label: "⚡ Auto MP" },
  { id: "sin_wa", label: "Sin enviar WA" },
  { id: "borradores", label: "Borradores" },
];

export default function FacturasPage() {
  const { negocio } = useAuth();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("facturas")
      .select("*, clientes(nombre, telefono, cuit_dni)")
      .order("created_at", { ascending: false })
      .limit(200);
    setFacturas((data as Factura[]) ?? []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    let lista = facturas;
    if (filtro === "auto_mp") lista = lista.filter((f) => f.origen === "mercadopago");
    if (filtro === "sin_wa")
      lista = lista.filter((f) => f.estado === "emitida" && !f.wa_enviado);
    if (filtro === "borradores") lista = lista.filter((f) => f.estado === "borrador");

    const q = busqueda.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (f) =>
          (f.clientes?.nombre ?? "").toLowerCase().includes(q) ||
          String(f.numero).includes(q) ||
          formatoNumeroFactura(f.tipo, f.numero).toLowerCase().includes(q)
      );
    }
    return lista;
  }, [facturas, filtro, busqueda]);

  async function onWhatsApp(f: Factura) {
    await enviarPorWhatsApp(f.id, {
      nombreCliente: f.clientes?.nombre ?? "Cliente",
      tipo: f.tipo,
      numero: f.numero,
      puntoVenta: negocio?.punto_venta ?? 1,
      total: f.total,
      cae: f.cae,
      telefono: f.clientes?.telefono,
    });
    cargar();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold">Facturas</h1>
        <Link
          href="/facturas/nueva"
          className="inline-flex items-center gap-1.5 rounded-btn bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <Plus size={15} />
          Nueva factura
        </Link>
      </header>

      {/* Filtros pill + buscador */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFiltro(id)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
              filtro === id
                ? "bg-brand text-white"
                : "border border-line bg-surface text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Cliente o número…"
            className="w-[220px] rounded-btn border border-line bg-[#1A2235] py-2 pl-8 pr-3 text-[13px] placeholder:text-text-muted"
          />
        </div>
      </div>

      <Card className="p-0">
        <div className="divide-y divide-line">
          {visibles.map((f) => {
            const nombre = f.clientes?.nombre ?? "Consumidor Final";
            const puedeWA = f.estado === "emitida" && !f.wa_enviado;
            return (
              <div key={f.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar nombre={nombre} auto={f.origen === "mercadopago"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{nombre}</p>
                  <p className="text-[11px] text-text-muted">
                    {formatoNumeroFactura(f.tipo, f.numero, negocio?.punto_venta ?? 1)}
                    {" · "}
                    {new Date(`${f.fecha}T00:00:00`).toLocaleDateString("es-AR")}
                    {f.estado === "error" && f.error_mensaje && (
                      <span className="text-status-error"> · {f.error_mensaje}</span>
                    )}
                  </p>
                </div>
                <span className="text-[13px] font-semibold tabular-nums">
                  {formatoPesos(f.total)}
                </span>
                <EstadoBadge estado={f.estado} origen={f.origen} />
                {puedeWA && (
                  <button
                    onClick={() => onWhatsApp(f)}
                    title="Enviar por WhatsApp"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-btn bg-whatsapp text-[#052e16] transition-all hover:brightness-110"
                  >
                    <MessageCircle size={15} />
                  </button>
                )}
              </div>
            );
          })}
          {!cargando && visibles.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-text-muted">
              No hay facturas para este filtro.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
