"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, AlertTriangle, CheckCircle2, Info, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { formatoPesos } from "@/lib/types";

interface Categoria {
  categoria: string;
  orden: number;
  limite_anual: number;
  solo_bienes: boolean;
}

interface FacturaMin {
  total: number | string;
  fecha: string;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default function MonotributoPage() {
  const { negocio, refrescar } = useAuth();
  const [cats, setCats] = useState<Categoria[]>([]);
  const [facturas, setFacturas] = useState<FacturaMin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const esMonotributo = negocio?.condicion_iva === "monotributo";

  useEffect(() => {
    if (!negocio) return;
    const desde = new Date();
    desde.setFullYear(desde.getFullYear() - 1);
    Promise.all([
      supabase.from("monotributo_categorias").select("*").order("orden"),
      supabase
        .from("facturas")
        .select("total, fecha")
        .in("estado", ["emitida", "enviada"])
        .gte("fecha", desde.toISOString().slice(0, 10)),
    ]).then(([c, f]) => {
      setCats((c.data as Categoria[]) ?? []);
      setFacturas((f.data as FacturaMin[]) ?? []);
      setCargando(false);
    });
  }, [negocio]);

  const facturado = useMemo(
    () => facturas.reduce((a, f) => a + Number(f.total), 0),
    [facturas]
  );

  // Ingresos de los últimos 6 meses para el gráfico
  const porMes = useMemo(() => {
    const hoy = new Date();
    const buckets: { label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      buckets.push({ label: MESES[d.getMonth()], total: 0 });
    }
    for (const f of facturas) {
      const d = new Date(`${f.fecha}T00:00:00`);
      const diff =
        (hoy.getFullYear() - d.getFullYear()) * 12 + (hoy.getMonth() - d.getMonth());
      if (diff >= 0 && diff <= 5) buckets[5 - diff].total += Number(f.total);
    }
    return buckets;
  }, [facturas]);

  const catDeclarada = cats.find((c) => c.categoria === negocio?.categoria_monotributo);
  // Categoría más chica cuyo tope alcanza para lo facturado
  const catCorresponde = cats.find((c) => facturado <= Number(c.limite_anual));

  async function setCategoria(cat: string) {
    if (!negocio) return;
    setGuardando(true);
    await supabase.from("negocios").update({ categoria_monotributo: cat }).eq("id", negocio.id);
    await refrescar();
    setGuardando(false);
  }

  const limite = catDeclarada ? Number(catDeclarada.limite_anual) : null;
  const pct = limite ? Math.min(100, Math.round((facturado / limite) * 100)) : null;
  const seExcede = limite != null && facturado > limite;
  // Sugerir recategorización si la categoría que le corresponde difiere de la declarada
  const sugerir =
    catDeclarada &&
    catCorresponde &&
    catCorresponde.categoria !== catDeclarada.categoria;

  const maxMes = Math.max(1, ...porMes.map((m) => m.total));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-[18px] font-semibold">Mi Monotributo</h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          Cuánto llevás facturado, en qué categoría estás y si te conviene recategorizar.
        </p>
      </header>

      {!esMonotributo && (
        <Card glass className="animate-fade-up">
          <p className="flex items-start gap-2 text-[13px] text-text-secondary">
            <Info size={16} className="mt-0.5 shrink-0 text-brand-hover" />
            Esta sección es para monotributistas. Tu negocio está como Responsable Inscripto —
            cambialo en Configuración → Negocio si corresponde.
          </p>
        </Card>
      )}

      {esMonotributo && (
        <>
          {/* ---------- Uso del límite anual ---------- */}
          <Card glass className="animate-fade-up space-y-4" style={{ animationDelay: "40ms" }}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium text-text-secondary">
                Facturado en los últimos 12 meses
              </p>
              {catDeclarada && (
                <span className="rounded-full bg-brand-dim px-3 py-1 text-[12px] font-semibold text-brand-hover">
                  Categoría {catDeclarada.categoria}
                </span>
              )}
            </div>

            <p className="text-[34px] font-bold leading-none tabular-nums">
              {cargando ? "…" : formatoPesos(facturado)}
            </p>

            {limite != null ? (
              <div className="space-y-2">
                <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      seExcede
                        ? "bg-status-error"
                        : pct! >= 80
                          ? "bg-status-warn"
                          : "bg-gradient-to-r from-brand to-accent"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span
                    className={
                      seExcede
                        ? "font-semibold text-status-error"
                        : pct! >= 80
                          ? "font-semibold text-status-warn"
                          : "text-text-secondary"
                    }
                  >
                    Usaste el {pct}% de tu límite
                  </span>
                  <span className="tabular-nums text-text-muted">
                    Tope categoría {catDeclarada!.categoria}: {formatoPesos(limite)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-btn border border-line bg-[#1A2235] p-3">
                <p className="mb-2 text-[12px] text-text-secondary">
                  Elegí tu categoría de monotributo para ver cuánto te queda de margen:
                </p>
                <SelectorCategoria
                  cats={cats}
                  valor={negocio?.categoria_monotributo ?? ""}
                  onChange={setCategoria}
                  guardando={guardando}
                />
              </div>
            )}
          </Card>

          {/* ---------- Recategorización ---------- */}
          {sugerir && (
            <Card
              glass
              hover
              className="animate-fade-up border-brand/30 shadow-glow-sm"
              style={{ animationDelay: "80ms" }}
            >
              <p className="flex items-center gap-2 text-[13px] font-semibold text-brand-hover">
                <TrendingUp size={16} />
                Te conviene revisar tu categoría
              </p>
              <p className="mt-1.5 text-[12px] text-text-secondary">
                Por lo que facturaste, la categoría que te corresponde es la{" "}
                <strong>{catCorresponde!.categoria}</strong>. Hoy estás en la{" "}
                <strong>{catDeclarada!.categoria}</strong>.
              </p>
              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-[15px] font-bold text-text-secondary">
                    {catDeclarada!.categoria}
                  </span>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    Actual
                  </div>
                </div>
                <ArrowRight size={18} className="text-text-muted" />
                <div className="flex items-center gap-2.5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-[15px] font-bold text-white shadow-glow">
                    {catCorresponde!.categoria}
                  </span>
                  <div className="text-[10px] uppercase tracking-wide text-brand-hover">
                    Sugerida
                  </div>
                </div>
                <button
                  onClick={() => setCategoria(catCorresponde!.categoria)}
                  disabled={guardando}
                  className="ml-auto rounded-btn bg-brand px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : `Pasar a ${catCorresponde!.categoria}`}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-text-muted">
                La recategorización se hace en enero y julio en el sitio de AFIP. Esto es una
                orientación según tu facturación.
              </p>
            </Card>
          )}

          {catDeclarada && !sugerir && !seExcede && (
            <Card glass className="animate-fade-up" style={{ animationDelay: "80ms" }}>
              <p className="flex items-center gap-2 text-[13px] text-status-ok">
                <CheckCircle2 size={16} />
                Estás bien en la categoría {catDeclarada.categoria} — no necesitás recategorizar
                por ahora.
              </p>
            </Card>
          )}

          {seExcede && (
            <Card glass className="animate-fade-up border-status-error/30" style={{ animationDelay: "80ms" }}>
              <p className="flex items-start gap-2 text-[13px] text-status-error">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Te pasaste del tope de la categoría {catDeclarada!.categoria}. Tenés que
                  recategorizar {catCorresponde ? `a la ${catCorresponde.categoria}` : "o revisar tu situación"}{" "}
                  para no quedar excluido del monotributo.
                </span>
              </p>
            </Card>
          )}

          {/* ---------- Ingresos por mes ---------- */}
          <Card glass className="animate-fade-up space-y-4" style={{ animationDelay: "120ms" }}>
            <p className="text-[13px] font-medium text-text-secondary">
              Ingresos de los últimos 6 meses
            </p>
            <div className="flex items-end justify-between gap-2 pt-2">
              {porMes.map((m, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-[10px] tabular-nums text-text-muted">
                    {m.total > 0 ? formatoPesosCorto(m.total) : ""}
                  </span>
                  <div className="flex h-28 w-full items-end">
                    <div
                      className="w-full rounded-t-[4px] bg-gradient-to-t from-brand/40 to-accent transition-all duration-700"
                      style={{ height: `${Math.max(4, (m.total / maxMes) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-text-secondary">{m.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Cambiar categoría (siempre disponible) */}
          {catDeclarada && (
            <Card glass className="animate-fade-up" style={{ animationDelay: "160ms" }}>
              <p className="mb-2 text-[12px] font-medium text-text-secondary">Cambiar mi categoría</p>
              <SelectorCategoria
                cats={cats}
                valor={negocio?.categoria_monotributo ?? ""}
                onChange={setCategoria}
                guardando={guardando}
              />
            </Card>
          )}

          <p className="animate-fade-up px-1 text-[11px] text-text-muted">
            Los topes son valores de referencia {cats.length ? "(escala 2026)" : ""}. Verificá los
            montos oficiales en{" "}
            <Link
              href="https://www.afip.gob.ar/monotributo/categorias.asp"
              target="_blank"
              className="text-brand-hover hover:underline"
            >
              el sitio de AFIP
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function SelectorCategoria({
  cats,
  valor,
  onChange,
  guardando,
}: {
  cats: Categoria[];
  valor: string;
  onChange: (c: string) => void;
  guardando: boolean;
}) {
  return (
    <select
      value={valor}
      disabled={guardando}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px] disabled:opacity-50"
    >
      <option value="">Elegí tu categoría…</option>
      {cats.map((c) => (
        <option key={c.categoria} value={c.categoria}>
          {c.categoria} · hasta {formatoPesos(Number(c.limite_anual))}
          {c.solo_bienes ? " (solo venta de bienes)" : ""}
        </option>
      ))}
    </select>
  );
}

// $1.234.567 → "$1,2M" / "$850k" para las etiquetas del gráfico
function formatoPesosCorto(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
