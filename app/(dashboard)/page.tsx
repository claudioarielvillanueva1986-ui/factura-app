"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  TrendingUp,
  CalendarDays,
  Zap,
  MessageCircle,
  AlertTriangle,
  Bell,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EstadoBadge } from "@/components/ui/EstadoBadge";
import { Contador } from "@/components/ui/Contador";
import { Skeleton, SkeletonLista, SkeletonGrafico } from "@/components/ui/Skeleton";
import { formatoPesos, formatoNumeroFactura, type ResumenDashboard } from "@/lib/types";

const entero = (n: number) => String(Math.round(n));

export default function DashboardPage() {
  const [resumen, setResumen] = useState<ResumenDashboard | null>(null);

  useEffect(() => {
    supabase
      .rpc("resumen_dashboard")
      .then(({ data }) => setResumen(data as ResumenDashboard | null));
  }, []);

  const stats = [
    {
      label: "Facturado hoy",
      raw: resumen?.total_hoy ?? 0,
      format: formatoPesos,
      icon: TrendingUp,
      color: "text-brand-hover",
    },
    {
      label: "Este mes",
      raw: resumen?.total_mes ?? 0,
      format: formatoPesos,
      sub: `${resumen?.cantidad_mes ?? 0} facturas`,
      icon: CalendarDays,
      color: "text-text-primary",
    },
    {
      label: "Auto MP",
      raw: resumen?.auto_mp ?? 0,
      format: entero,
      sub: "auto-emitidas este mes",
      icon: Zap,
      color: "text-accent-light",
    },
    {
      label: "Sin enviar WA",
      raw: resumen?.sin_enviar ?? 0,
      format: entero,
      sub: "pendientes de envío",
      icon: MessageCircle,
      color: "text-status-warn",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold">Dashboard</h1>
        <Link
          href="/facturas/nueva"
          className="btn-sheen inline-flex items-center gap-1.5 rounded-btn px-4 py-2 text-[13px] font-medium text-white transition-all active:scale-[0.97]"
        >
          <Plus size={15} />
          Nueva factura
        </Link>
      </header>

      <AlertasMonotributo />

      {/* Stats 2x2 en mobile, 4 columnas en desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, raw, format, sub, icon: Icon, color }, i) => (
          <Card
            key={label}
            glass
            hover
            className="animate-fade-up p-4"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-text-secondary">{label}</span>
              <span className="icon-chip flex h-7 w-7 items-center justify-center rounded-lg">
                <Icon size={14} className="text-text-primary/80" />
              </span>
            </div>
            {resumen ? (
              <>
                <Contador
                  value={raw}
                  format={format}
                  className={`mt-2 block text-[22px] font-semibold tabular-nums ${color}`}
                />
                {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
              </>
            ) : (
              <>
                <Skeleton className="mt-3 h-6 w-24" />
                <Skeleton className="mt-2 h-2.5 w-16" />
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Últimos 7 días */}
      <Card glass className="animate-fade-up" style={{ animationDelay: "300ms" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-text-secondary">
            Últimos 7 días
          </h2>
          <div className="flex items-center gap-4 text-[11px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-brand" /> Manual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" /> Auto MP
            </span>
          </div>
        </div>
        <div className="h-[220px]">
          {!resumen ? (
            <SkeletonGrafico />
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={resumen?.semana ?? []} barGap={2}>
              <defs>
                <linearGradient id="gradManual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="gradAuto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5EEAD4" />
                  <stop offset="100%" stopColor="#14B8A6" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="dia"
                tick={{ fill: "#64748B", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#64748B", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "#1A2235",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#94A3B8" }}
                formatter={(value, name) => [
                  formatoPesos(Number(value)),
                  name === "manual" ? "Manual" : "Auto MP",
                ]}
              />
              <Bar dataKey="manual" fill="url(#gradManual)" radius={[5, 5, 0, 0]} maxBarSize={28} />
              <Bar dataKey="auto_mp" fill="url(#gradAuto)" radius={[5, 5, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Últimas facturas */}
      <Card glass className="animate-fade-up p-0" style={{ animationDelay: "380ms" }}>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[13px] font-medium text-text-secondary">
            Últimas facturas
          </h2>
          <Link
            href="/facturas"
            className="text-[12px] text-brand-hover hover:underline"
          >
            Ver todas
          </Link>
        </div>
        <div className="divide-y divide-line">
          {!resumen && <SkeletonLista filas={3} />}
          {(resumen?.ultimas ?? []).map((f) => (
            <Link
              key={f.id}
              href="/facturas"
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:px-5"
            >
              <Avatar nombre={f.cliente_nombre} auto={f.origen === "mercadopago"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{f.cliente_nombre}</p>
                <p className="text-[11px] text-text-muted">
                  {formatoNumeroFactura(f.tipo, f.numero)} ·{" "}
                  {new Date(`${f.fecha}T00:00:00`).toLocaleDateString("es-AR")}
                </p>
              </div>
              <span className="text-[13px] font-semibold tabular-nums">
                {formatoPesos(f.total)}
              </span>
              <EstadoBadge estado={f.estado} origen={f.origen} />
            </Link>
          ))}
          {resumen && resumen.ultimas.length === 0 && (
            <p className="px-5 py-8 text-center text-[13px] text-text-muted">
              Todavía no emitiste facturas. Arrancá con{" "}
              <Link href="/facturas/nueva" className="text-brand-hover hover:underline">
                tu primera factura
              </Link>
              .
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Alertas del monotributo en el dashboard ---------- */

interface Alerta {
  tono: "error" | "warn" | "info";
  texto: string;
  href: string;
}

function AlertasMonotributo() {
  const { negocio } = useAuth();
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  useEffect(() => {
    if (!negocio) return;
    const desde = new Date();
    desde.setFullYear(desde.getFullYear() - 1);
    const esMono = negocio.condicion_iva === "monotributo";
    Promise.all([
      supabase.from("monotributo_categorias").select("categoria, limite_anual"),
      supabase
        .from("facturas")
        .select("total, cobrada, estado")
        .in("estado", ["emitida", "enviada"])
        .gte("fecha", desde.toISOString().slice(0, 10)),
    ]).then(([cRes, fRes]) => {
      const cats = (cRes.data as { categoria: string; limite_anual: number }[]) ?? [];
      const facturas = (fRes.data as { total: number; cobrada: boolean }[]) ?? [];
      const facturado = facturas.reduce((a, f) => a + Number(f.total), 0);
      const impagas = facturas.filter((f) => !f.cobrada);
      const impagoTotal = impagas.reduce((a, f) => a + Number(f.total), 0);
      const nuevas: Alerta[] = [];

      if (esMono) {
        const cat = cats.find((c) => c.categoria === negocio.categoria_monotributo);
        if (cat) {
          const pct = Math.round((facturado / Number(cat.limite_anual)) * 100);
          if (pct >= 100)
            nuevas.push({
              tono: "error",
              texto: `Te pasaste del tope de la categoría ${cat.categoria} — tenés que recategorizar.`,
              href: "/monotributo",
            });
          else if (pct >= 80)
            nuevas.push({
              tono: "warn",
              texto: `Usaste el ${pct}% de tu límite anual del monotributo.`,
              href: "/monotributo",
            });
        }
        const cuota = proximaCuotaMonotributo();
        const d = diasHasta(cuota);
        if (d <= 5)
          nuevas.push({
            tono: "warn",
            texto: `Tu cuota de monotributo vence ${
              d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`
            } (${cuota.getDate()}/${cuota.getMonth() + 1}).`,
            href: "/monotributo",
          });
      }

      if (impagas.length > 0)
        nuevas.push({
          tono: "info",
          texto: `Tenés ${impagas.length} factura${impagas.length === 1 ? "" : "s"} impaga${
            impagas.length === 1 ? "" : "s"
          } por ${formatoPesos(impagoTotal)}.`,
          href: "/facturas",
        });

      setAlertas(nuevas);
    });
  }, [negocio]);

  if (!alertas.length) return null;

  const estilo: Record<Alerta["tono"], string> = {
    error: "border-status-error/30 bg-status-error/10 text-status-error",
    warn: "border-status-warn/30 bg-status-warn/10 text-status-warn",
    info: "border-brand/30 bg-brand-dim text-brand-hover",
  };

  return (
    <div className="animate-fade-up space-y-2">
      {alertas.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className={`flex items-center gap-2.5 rounded-card border px-4 py-2.5 text-[12px] transition-opacity hover:opacity-90 ${estilo[a.tono]}`}
        >
          {a.tono === "info" ? (
            <Bell size={15} className="shrink-0" />
          ) : (
            <AlertTriangle size={15} className="shrink-0" />
          )}
          <span className="flex-1">{a.texto}</span>
          <ArrowRight size={14} className="shrink-0 opacity-70" />
        </Link>
      ))}
    </div>
  );
}

function diasHasta(fecha: Date) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((fecha.getTime() - hoy.getTime()) / 86_400_000));
}

function proximaCuotaMonotributo() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dia20 = new Date(hoy.getFullYear(), hoy.getMonth(), 20);
  return hoy <= dia20 ? dia20 : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 20);
}
