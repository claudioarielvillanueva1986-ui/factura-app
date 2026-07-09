"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, TrendingDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { formatoPesos } from "@/lib/types";

interface Egreso {
  id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  categoria: string | null;
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function EgresosPage() {
  const { negocio } = useAuth();
  const [egresos, setEgresos] = useState<Egreso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("egresos")
      .select("id, fecha, descripcion, monto, categoria")
      .order("fecha", { ascending: false })
      .limit(200);
    setEgresos((data as Egreso[]) ?? []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!negocio || !descripcion.trim() || !(parseFloat(monto) > 0)) return;
    setGuardando(true);
    await supabase.from("egresos").insert({
      negocio_id: negocio.id,
      descripcion: descripcion.trim(),
      monto: parseFloat(monto),
      fecha,
    });
    setDescripcion("");
    setMonto("");
    setFecha(hoyISO());
    setGuardando(false);
    cargar();
  }

  async function eliminar(id: string) {
    setEgresos((prev) => prev.filter((x) => x.id !== id));
    await supabase.from("egresos").delete().eq("id", id);
  }

  const totalMes = useMemo(() => {
    const m = new Date().toISOString().slice(0, 7);
    return egresos.filter((e) => e.fecha.startsWith(m)).reduce((a, e) => a + Number(e.monto), 0);
  }, [egresos]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="flex animate-fade-up items-center gap-3">
        <Link
          href="/monotributo"
          className="rounded-btn border border-line bg-surface p-2 text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-[16px] font-semibold">Egresos</h1>
          <p className="text-[12px] text-text-secondary">
            Cargá tus gastos para ver el resultado real de tu negocio.
          </p>
        </div>
      </header>

      <Card glass className="animate-fade-up p-4" style={{ animationDelay: "30ms" }}>
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
          <TrendingDown size={13} className="text-status-warn" />
          Gastos de este mes
        </p>
        <p className="mt-0.5 text-[22px] font-semibold tabular-nums text-status-warn">
          {formatoPesos(totalMes)}
        </p>
      </Card>

      {/* Alta rápida */}
      <Card glass className="animate-fade-up space-y-3" style={{ animationDelay: "60ms" }}>
        <form onSubmit={agregar} className="space-y-3">
          <Input
            id="e-desc"
            label="Descripción"
            placeholder="Ej: alquiler, mercadería, servicios…"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            required
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[140px]">
              <Input
                id="e-monto"
                label="Monto"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                required
              />
            </div>
            <div className="w-[160px]">
              <Input
                id="e-fecha"
                label="Fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={guardando} className="py-2.5">
              <Plus size={15} />
              {guardando ? "Guardando…" : "Agregar gasto"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Lista */}
      <Card glass className="animate-fade-up p-0" style={{ animationDelay: "90ms" }}>
        <div className="divide-y divide-line">
          {egresos.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{e.descripcion}</p>
                <p className="text-[11px] text-text-muted">
                  {new Date(`${e.fecha}T00:00:00`).toLocaleDateString("es-AR")}
                </p>
              </div>
              <span className="text-[13px] font-semibold tabular-nums text-status-warn">
                −{formatoPesos(Number(e.monto))}
              </span>
              <button
                onClick={() => eliminar(e.id)}
                className="rounded-btn p-1.5 text-text-muted transition-colors hover:text-status-error"
                title="Eliminar"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {cargando && <SkeletonLista filas={4} />}
          {!cargando && egresos.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-text-muted">
              Todavía no cargaste gastos. Agregá el primero arriba.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
