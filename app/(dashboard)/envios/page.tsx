"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { enviarPorWhatsApp } from "@/lib/whatsapp";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { formatoPesos, formatoNumeroFactura, type Factura } from "@/lib/types";

// Cola de comprobantes emitidos pendientes de envío por WhatsApp.
export default function EnviosPage() {
  const { negocio } = useAuth();
  const [pendientes, setPendientes] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("facturas")
      .select("*, clientes(nombre, telefono, cuit_dni)")
      .eq("estado", "emitida")
      .eq("wa_enviado", false)
      .order("created_at", { ascending: false });
    setPendientes((data as Factura[]) ?? []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(f: Factura) {
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
      <header className="animate-fade-up">
        <h1 className="text-[15px] font-semibold">Envíos WA</h1>
        <p className="mt-1 text-[12px] text-text-secondary">
          Comprobantes emitidos que todavía no enviaste por WhatsApp.
        </p>
      </header>

      <Card glass className="animate-fade-up p-0" style={{ animationDelay: "80ms" }}>
        <div className="divide-y divide-line">
          {pendientes.map((f) => {
            const nombre = f.clientes?.nombre ?? "Consumidor Final";
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
                    {" · CAE "}
                    {f.cae ?? "-"}
                    {!f.clientes?.telefono && (
                      <span className="text-status-warn"> · sin teléfono cargado</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[13px] font-semibold tabular-nums">
                    {formatoPesos(f.total)}
                  </span>
                  <a
                    href={`/api/facturas/${f.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    title="Ver / descargar PDF"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-btn border border-line text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <FileDown size={15} />
                  </a>
                  <button
                    onClick={() => enviar(f)}
                    className="inline-flex items-center gap-1.5 rounded-btn bg-whatsapp px-3 py-2 text-[12px] font-semibold text-[#052e16] transition-all hover:brightness-110"
                  >
                    <MessageCircle size={14} />
                    Enviar
                  </button>
                </div>
              </div>
            );
          })}
          {cargando && <SkeletonLista filas={4} />}
          {!cargando && pendientes.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-text-muted">
              🎉 Nada pendiente: todos los comprobantes fueron enviados.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
