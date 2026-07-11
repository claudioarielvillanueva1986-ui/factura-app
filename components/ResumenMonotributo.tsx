"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { formatoPesos } from "@/lib/types";

interface Cat {
  categoria: string;
  limite_anual: number;
}

// Tarjeta principal del dashboard, al estilo del "Resumen Monotributo" de la
// competencia: barra grande con el % usado del límite anual, lo facturado y
// el SALDO A FACTURAR (cuánto más puede facturar antes de tener que recategorizar).
export function ResumenMonotributo() {
  const { negocio } = useAuth();
  const [cats, setCats] = useState<Cat[]>([]);
  const [facturado, setFacturado] = useState(0);
  const [listo, setListo] = useState(false);

  const esMonotributo = negocio?.condicion_iva === "monotributo";

  useEffect(() => {
    if (!negocio || !esMonotributo) return;
    const desde = new Date();
    desde.setFullYear(desde.getFullYear() - 1);
    Promise.all([
      supabase.from("monotributo_categorias").select("categoria, limite_anual").order("orden"),
      supabase
        .from("facturas")
        .select("total")
        .in("estado", ["emitida", "enviada"])
        .gte("fecha", desde.toISOString().slice(0, 10)),
    ]).then(([c, f]) => {
      setCats((c.data as Cat[]) ?? []);
      setFacturado(((f.data as { total: number }[]) ?? []).reduce((a, x) => a + Number(x.total), 0));
      setListo(true);
    });
  }, [negocio, esMonotributo]);

  const cat = useMemo(
    () => cats.find((c) => c.categoria === negocio?.categoria_monotributo),
    [cats, negocio]
  );

  if (!esMonotributo || !listo) return null;

  // Sin categoría cargada: invitamos a elegirla.
  if (!cat) {
    return (
      <Link href="/monotributo" className="block">
        <Card glass hover className="animate-fade-up flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Activá tu resumen de monotributo</p>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Elegí tu categoría y mirá cuánto te queda para facturar.
            </p>
          </div>
          <ArrowRight size={18} className="shrink-0 text-brand-hover" />
        </Card>
      </Link>
    );
  }

  const limite = Number(cat.limite_anual);
  const pct = Math.min(100, Math.round((facturado / limite) * 100));
  const saldo = Math.max(0, limite - facturado);
  const seExcede = facturado > limite;

  return (
    <Card glass className="animate-fade-up space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Resumen monotributo</p>
          <p className="text-[13px] text-text-secondary">Facturación últimos 12 meses</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[14px] font-bold text-white shadow-glow-sm">
          {cat.categoria}
        </span>
      </div>

      {/* Barra grande con el % */}
      <div>
        <div className="mb-1.5 flex items-end justify-between">
          <span
            className={`text-[32px] font-bold leading-none tabular-nums ${
              seExcede ? "text-status-error" : pct >= 80 ? "text-status-warn" : "text-text-primary"
            }`}
          >
            {pct}%
          </span>
          <span className="text-[12px] text-text-muted">del límite usado</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              seExcede ? "bg-status-error" : pct >= 80 ? "bg-status-warn" : "bg-gradient-to-r from-brand to-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Límite anual (cat. {cat.categoria})</span>
          <span className="tabular-nums">{formatoPesos(limite)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Facturado 12 meses</span>
          <span className="tabular-nums">{formatoPesos(facturado)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-2">
          <span className="font-medium">Saldo a facturar</span>
          <span
            className={`text-[16px] font-semibold tabular-nums ${
              seExcede ? "text-status-error" : "text-status-ok"
            }`}
          >
            {seExcede ? formatoPesos(0) : formatoPesos(saldo)}
          </span>
        </div>
      </div>

      {seExcede && (
        <p className="flex items-start gap-1.5 rounded-btn bg-status-error/10 px-3 py-2 text-[12px] text-status-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Te pasaste del tope de tu categoría. Recategorizá para no quedar excluido.
        </p>
      )}

      <Link
        href="/monotributo"
        className="flex items-center justify-center gap-1.5 rounded-btn border border-line py-2 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        Ver mi monotributo
        <ArrowRight size={14} />
      </Link>
    </Card>
  );
}
