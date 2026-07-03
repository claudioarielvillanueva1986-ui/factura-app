"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import type { Cliente } from "@/lib/types";

const FORM_VACIO = { nombre: "", cuit_dni: "", email: "", telefono: "" };

export default function ClientesPage() {
  const { negocio } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [modalAbierto, setModalAbierto] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("clientes").select("*").order("nombre");
    setClientes((data as Cliente[]) ?? []);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        (c.cuit_dni ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  }, [clientes, busqueda]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!negocio) {
      setError("Todavía se están cargando los datos del negocio, probá de nuevo");
      return;
    }
    setError(null);
    setGuardando(true);
    const { error } = await supabase.from("clientes").insert({
      negocio_id: negocio.id,
      nombre: form.nombre.trim(),
      cuit_dni: form.cuit_dni.trim() || null,
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
    });
    setGuardando(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(FORM_VACIO);
    setModalAbierto(false);
    cargar();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold">Clientes</h1>
        <Button onClick={() => setModalAbierto(true)}>
          <Plus size={15} />
          Nuevo cliente
        </Button>
      </header>

      <div className="relative max-w-xs">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre, CUIT o email…"
          className="w-full rounded-btn border border-line bg-[#1A2235] py-2 pl-8 pr-3 text-[13px] placeholder:text-text-muted"
        />
      </div>

      <Card className="p-0">
        <div className="divide-y divide-line">
          {visibles.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar nombre={c.nombre} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{c.nombre}</p>
                <p className="truncate text-[11px] text-text-muted">
                  {[c.cuit_dni, c.email, c.telefono].filter(Boolean).join(" · ") ||
                    "Sin datos de contacto"}
                </p>
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-text-secondary">
                {c.condicion_iva.replaceAll("_", " ")}
              </span>
            </div>
          ))}
          {visibles.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-text-muted">
              {busqueda ? "Sin resultados." : "Todavía no cargaste clientes."}
            </p>
          )}
        </div>
      </Card>

      {/* Modal nuevo cliente */}
      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setModalAbierto(false)}
        >
          <div
            className="w-full max-w-sm rounded-card border border-line bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Nuevo cliente</h2>
              <button
                onClick={() => setModalAbierto(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={guardar} className="space-y-3">
              <Input
                id="c-nombre"
                label="Nombre *"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
              />
              <Input
                id="c-cuit"
                label="CUIT / DNI"
                value={form.cuit_dni}
                onChange={(e) => setForm({ ...form, cuit_dni: e.target.value })}
              />
              <Input
                id="c-email"
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Input
                id="c-telefono"
                label="Teléfono (con código de país, ej: 549351…)"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
              {error && (
                <p className="rounded-btn bg-status-error/15 px-3 py-2 text-[12px] text-status-error">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={guardando} className="w-full">
                {guardando ? "Guardando…" : "Guardar cliente"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
