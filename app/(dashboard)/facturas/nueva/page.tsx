"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, CheckCircle2, MessageCircle, FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { enviarPorWhatsApp } from "@/lib/whatsapp";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  formatoPesos,
  formatoNumeroFactura,
  type Cliente,
  type Factura,
  type TipoFactura,
} from "@/lib/types";

interface ItemForm {
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
}

const ITEM_VACIO: ItemForm = { descripcion: "", cantidad: "1", precio_unitario: "" };

export default function NuevaFacturaPage() {
  const { negocio } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [tipo, setTipo] = useState<TipoFactura>("C");
  const [clienteNombre, setClienteNombre] = useState("");
  const [items, setItems] = useState<ItemForm[]>([{ ...ITEM_VACIO }]);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<{
    factura: Factura;
    cae: string;
    telefono?: string | null;
    nombreCliente: string;
  } | null>(null);

  const esMonotributo = negocio?.condicion_iva === "monotributo";
  const tiposDisponibles: TipoFactura[] = esMonotributo ? ["C"] : ["A", "B", "C"];

  useEffect(() => {
    if (esMonotributo) setTipo("C");
  }, [esMonotributo]);

  useEffect(() => {
    supabase
      .from("clientes")
      .select("*")
      .order("nombre")
      .then(({ data }) => setClientes((data as Cliente[]) ?? []));
  }, []);

  const total = useMemo(() => {
    const subtotal = items.reduce(
      (acc, it) =>
        acc + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0),
      0
    );
    const iva = tipo === "A" ? subtotal * 0.21 : 0;
    return { subtotal, iva, total: subtotal + iva };
  }, [items, tipo]);

  function setItem(i: number, campo: keyof ItemForm, valor: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }

  async function emitir() {
    setError(null);
    setEmitiendo(true);
    try {
      if (!negocio) {
        throw new Error("Todavía se están cargando los datos del negocio, probá de nuevo");
      }
      const itemsValidos = items.filter(
        (it) => it.descripcion.trim() && parseFloat(it.precio_unitario) > 0
      );
      if (itemsValidos.length === 0) {
        throw new Error("Agregá al menos un ítem con descripción y precio");
      }

      // Cliente: buscar por nombre exacto o crear al vuelo
      let clienteId: string | null = null;
      const nombre = clienteNombre.trim();
      if (nombre) {
        const existente = clientes.find(
          (c) => c.nombre.toLowerCase() === nombre.toLowerCase()
        );
        if (existente) {
          clienteId = existente.id;
        } else {
          const { data: nuevo, error: errCliente } = await supabase
            .from("clientes")
            .insert({ nombre, negocio_id: negocio.id })
            .select()
            .single();
          if (errCliente) throw new Error(errCliente.message);
          clienteId = nuevo.id;
        }
      }

      // 1) Crear borrador con numeración e IVA calculados en la RPC
      const { data: factura, error: errRpc } = await supabase.rpc("crear_factura", {
        p_tipo: tipo,
        p_cliente_id: clienteId,
        p_items: itemsValidos.map((it) => ({
          descripcion: it.descripcion.trim(),
          cantidad: parseFloat(it.cantidad) || 1,
          precio_unitario: parseFloat(it.precio_unitario) || 0,
        })),
      });
      if (errRpc) throw new Error(errRpc.message);

      const facturaCreada = factura as Factura;

      // 2) Emitir contra ARCA vía Netlify Function
      const res = await fetch("/api/arca/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factura_id: facturaCreada.id }),
      });
      const emision = await res.json();
      if (!res.ok) {
        throw new Error(emision.error ?? "Falló la emisión en ARCA");
      }

      const clienteSel = clientes.find((c) => c.id === clienteId);
      setExito({
        factura: { ...facturaCreada, numero: emision.numero ?? facturaCreada.numero },
        cae: emision.cae,
        telefono: clienteSel?.telefono,
        nombreCliente: nombre || "Cliente",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal");
    } finally {
      setEmitiendo(false);
    }
  }

  // ---------- Pantalla de éxito con CAE ----------
  if (exito) {
    return (
      <div className="mx-auto max-w-md pt-10">
        <Card className="space-y-4 text-center">
          <CheckCircle2 size={44} className="mx-auto text-status-ok" />
          <div>
            <h1 className="text-[16px] font-semibold">¡Factura emitida!</h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              {formatoNumeroFactura(
                exito.factura.tipo,
                exito.factura.numero,
                negocio?.punto_venta ?? 1
              )}{" "}
              · {formatoPesos(exito.factura.total)}
            </p>
          </div>
          <div className="rounded-btn bg-[#1A2235] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">CAE</p>
            <p className="text-[15px] font-semibold tabular-nums">{exito.cae}</p>
          </div>
          <Button
            variant="whatsapp"
            className="w-full py-2.5"
            onClick={() =>
              enviarPorWhatsApp(exito.factura.id, {
                nombreCliente: exito.nombreCliente,
                tipo: exito.factura.tipo,
                numero: exito.factura.numero,
                puntoVenta: negocio?.punto_venta ?? 1,
                total: exito.factura.total,
                cae: exito.cae,
                telefono: exito.telefono,
              })
            }
          >
            <MessageCircle size={15} />
            Enviar por WhatsApp
          </Button>
          <a
            href={`/api/facturas/${exito.factura.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-btn border border-line py-2.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <FileDown size={15} />
            Ver / descargar PDF
          </a>
          <Link
            href="/facturas"
            className="block text-[12px] text-text-secondary hover:text-text-primary"
          >
            Volver a facturas
          </Link>
        </Card>
      </div>
    );
  }

  // ---------- Formulario ----------
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="flex items-center gap-3">
        <Link
          href="/facturas"
          className="rounded-btn border border-line bg-surface p-2 text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={15} />
        </Link>
        <h1 className="text-[15px] font-semibold">Nueva factura</h1>
      </header>

      <Card className="space-y-5">
        {/* Tipo */}
        <div>
          <p className="mb-2 text-[12px] font-medium text-text-secondary">
            Tipo de comprobante
            {esMonotributo && (
              <span className="ml-2 text-text-muted">(monotributo: solo C)</span>
            )}
          </p>
          <div className="flex gap-2">
            {tiposDisponibles.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`h-10 w-10 rounded-btn text-[14px] font-semibold transition-colors ${
                  tipo === t
                    ? "bg-brand text-white"
                    : "border border-line bg-[#1A2235] text-text-secondary hover:text-text-primary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Cliente */}
        <div>
          <Input
            id="cliente"
            label="Cliente"
            list="clientes-list"
            placeholder="Buscar o escribir un cliente nuevo…"
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
          />
          <datalist id="clientes-list">
            {clientes.map((c) => (
              <option key={c.id} value={c.nombre} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-text-muted">
            Vacío = Consumidor Final. Si el nombre no existe, se crea automáticamente.
          </p>
        </div>

        {/* Ítems */}
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-text-secondary">Ítems</p>
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <input
                placeholder="Descripción"
                value={it.descripcion}
                onChange={(e) => setItem(i, "descripcion", e.target.value)}
                className="min-w-[160px] flex-1 rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px] placeholder:text-text-muted"
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Cant."
                value={it.cantidad}
                onChange={(e) => setItem(i, "cantidad", e.target.value)}
                className="w-[70px] rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px] tabular-nums placeholder:text-text-muted"
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Precio"
                value={it.precio_unitario}
                onChange={(e) => setItem(i, "precio_unitario", e.target.value)}
                className="w-[110px] rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px] tabular-nums placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={items.length === 1}
                className="rounded-btn p-2 text-text-muted transition-colors hover:text-status-error disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { ...ITEM_VACIO }])}
            className="inline-flex items-center gap-1.5 text-[12px] text-brand-hover hover:underline"
          >
            <Plus size={13} />
            Agregar ítem
          </button>
        </div>

        {/* Totales en vivo */}
        <div className="space-y-1 border-t border-line pt-4 text-[13px]">
          <div className="flex justify-between text-text-secondary">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatoPesos(total.subtotal)}</span>
          </div>
          {tipo === "A" && (
            <div className="flex justify-between text-text-secondary">
              <span>IVA 21%</span>
              <span className="tabular-nums">{formatoPesos(total.iva)}</span>
            </div>
          )}
          <div className="flex justify-between text-[16px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatoPesos(total.total)}</span>
          </div>
        </div>

        {error && (
          <p className="rounded-btn bg-status-error/15 px-3 py-2 text-[12px] text-status-error">
            {error}
          </p>
        )}

        <Button
          onClick={emitir}
          disabled={emitiendo || total.total <= 0}
          className="w-full py-2.5"
        >
          {emitiendo ? "Emitiendo en ARCA…" : "Emitir factura"}
        </Button>
      </Card>
    </div>
  );
}
