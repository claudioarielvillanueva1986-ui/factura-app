"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, MessageCircle, FileDown, CircleDollarSign, Circle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { enviarPorWhatsApp } from "@/lib/whatsapp";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EstadoBadge } from "@/components/ui/EstadoBadge";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/useAuth";
import {
  formatoPesos,
  formatoNumeroFactura,
  type Factura,
} from "@/lib/types";

type Filtro = "todas" | "auto_mp" | "sin_wa" | "impagas" | "borradores";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "auto_mp", label: "⚡ Auto MP" },
  { id: "impagas", label: "Impagas" },
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
    if (filtro === "impagas")
      lista = lista.filter(
        (f) => (f.estado === "emitida" || f.estado === "enviada") && !f.cobrada
      );
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

  async function toggleCobrada(f: Factura) {
    // Optimista: actualizamos la UI y persistimos.
    setFacturas((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, cobrada: !x.cobrada } : x))
    );
    await supabase.from("facturas").update({ cobrada: !f.cobrada }).eq("id", f.id);
  }

  // Resumen de cobranzas sobre los comprobantes emitidos.
  const cobro = useMemo(() => {
    const emitidas = facturas.filter((f) => f.estado === "emitida" || f.estado === "enviada");
    const cobrado = emitidas.filter((f) => f.cobrada).reduce((a, f) => a + Number(f.total), 0);
    const impago = emitidas.filter((f) => !f.cobrada).reduce((a, f) => a + Number(f.total), 0);
    return { cobrado, impago, hay: emitidas.length > 0 };
  }, [facturas]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex animate-fade-up items-center justify-between">
        <h1 className="text-[15px] font-semibold">Facturas</h1>
        <Link
          href="/facturas/nueva"
          className="btn-sheen inline-flex items-center gap-1.5 rounded-btn px-4 py-2 text-[13px] font-medium text-white transition-all active:scale-[0.97]"
        >
          <Plus size={15} />
          Nueva factura
        </Link>
      </header>

      {/* Resumen de cobranzas */}
      {cobro.hay && (cobro.cobrado > 0 || cobro.impago > 0) && (
        <Card
          glass
          className="grid animate-fade-up grid-cols-2 gap-3 p-4"
          style={{ animationDelay: "30ms" }}
        >
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Cobrado</p>
            <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-status-ok">
              {formatoPesos(cobro.cobrado)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">No cobrado</p>
            <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-status-warn">
              {formatoPesos(cobro.impago)}
            </p>
          </div>
        </Card>
      )}

      {/* Filtros pill + buscador */}
      <div
        className="flex animate-fade-up flex-wrap items-center gap-2"
        style={{ animationDelay: "60ms" }}
      >
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
        <div className="relative w-full sm:ml-auto sm:w-[220px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Cliente o número…"
            className="w-full rounded-btn border border-line bg-[#1A2235] py-2 pl-8 pr-3 text-[13px] placeholder:text-text-muted"
          />
        </div>
      </div>

      <Card glass className="animate-fade-up p-0" style={{ animationDelay: "120ms" }}>
        <div className="divide-y divide-line">
          {visibles.map((f) => {
            const nombre = f.clientes?.nombre ?? "Consumidor Final";
            const puedeWA = f.estado === "emitida" && !f.wa_enviado;
            const tieneCae = Boolean(f.cae) && (f.estado === "emitida" || f.estado === "enviada");
            return (
              <div
                key={f.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:px-5"
              >
                <Avatar nombre={nombre} auto={f.origen === "mercadopago"} />
                <div className="min-w-0 flex-1 basis-36">
                  <p className="truncate text-[13px] font-medium">{nombre}</p>
                  <p className="truncate text-[11px] text-text-muted">
                    {formatoNumeroFactura(f.tipo, f.numero, negocio?.punto_venta ?? 1)}
                    {" · "}
                    {new Date(`${f.fecha}T00:00:00`).toLocaleDateString("es-AR")}
                    {f.estado === "error" && f.error_mensaje && (
                      <span className="text-status-error"> · {f.error_mensaje}</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[13px] font-semibold tabular-nums">
                    {formatoPesos(f.total)}
                  </span>
                  {tieneCae && (
                    <button
                      onClick={() => toggleCobrada(f)}
                      title={f.cobrada ? "Cobrada — tocá para marcar impaga" : "Impaga — tocá para marcar cobrada"}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                        f.cobrada
                          ? "bg-status-ok/15 text-status-ok"
                          : "bg-status-warn/15 text-status-warn hover:bg-status-warn/25"
                      }`}
                    >
                      {f.cobrada ? <CircleDollarSign size={13} /> : <Circle size={13} />}
                      {f.cobrada ? "Cobrada" : "Impaga"}
                    </button>
                  )}
                  <EstadoBadge estado={f.estado} origen={f.origen} />
                  {tieneCae && (
                    <a
                      href={`/api/facturas/${f.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      title="Ver / descargar PDF"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-btn border border-line text-text-secondary transition-colors hover:text-text-primary"
                    >
                      <FileDown size={15} />
                    </a>
                  )}
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
              </div>
            );
          })}
          {cargando && <SkeletonLista filas={6} />}
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
