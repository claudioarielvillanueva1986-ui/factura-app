"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { enviarPorWhatsApp } from "@/lib/whatsapp";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
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
      <header>
        <h1 className="text-[15px] font-semibold">Envíos WA</h1>
        <p className="mt-1 text-[12px] text-text-secondary">
          Comprobantes emitidos que todavía no enviaste por WhatsApp.
        </p>
      </header>

      <Card className="p-0">
        <div className="divide-y divide-line">
          {pendientes.map((f) => {
            const nombre = f.clientes?.nombre ?? "Consumidor Final";
            return (
              <div key={f.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar nombre={nombre} auto={f.origen === "mercadopago"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{nombre}</p>
                  <p className="text-[11px] text-text-muted">
                    {formatoNumeroFactura(f.tipo, f.numero, negocio?.punto_venta ?? 1)}
                    {" · CAE "}
                    {f.cae ?? "-"}
                    {!f.clientes?.telefono && (
                      <span className="text-status-warn"> · sin teléfono cargado</span>
                    )}
                  </p>
                </div>
                <span className="text-[13px] font-semibold tabular-nums">
                  {formatoPesos(f.total)}
                </span>
                <button
                  onClick={() => enviar(f)}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-whatsapp px-3 py-2 text-[12px] font-semibold text-[#052e16] transition-all hover:brightness-110"
                >
                  <MessageCircle size={14} />
                  Enviar
                </button>
              </div>
            );
          })}
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
