"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, TrendingUp, CalendarDays, Zap, MessageCircle } from "lucide-react";
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
import { Skeleton, SkeletonLista, SkeletonGrafico } from "@/components/ui/Skeleton";
import { formatoPesos, formatoNumeroFactura, type ResumenDashboard } from "@/lib/types";

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
      valor: formatoPesos(resumen?.total_hoy ?? 0),
      icon: TrendingUp,
      color: "text-brand-hover",
    },
    {
      label: "Este mes",
      valor: formatoPesos(resumen?.total_mes ?? 0),
      sub: `${resumen?.cantidad_mes ?? 0} facturas`,
      icon: CalendarDays,
      color: "text-text-primary",
    },
    {
      label: "Auto MP",
      valor: String(resumen?.auto_mp ?? 0),
      sub: "auto-emitidas este mes",
      icon: Zap,
      color: "text-accent-light",
    },
    {
      label: "Sin enviar WA",
      valor: String(resumen?.sin_enviar ?? 0),
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
          className="inline-flex items-center gap-1.5 rounded-btn bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <Plus size={15} />
          Nueva factura
        </Link>
      </header>

      {/* Stats 2x2 en mobile, 4 columnas en desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, valor, sub, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-text-secondary">{label}</span>
              <Icon size={15} className="text-text-muted" />
            </div>
            {resumen ? (
              <>
                <p className={`mt-2 text-[22px] font-semibold tabular-nums ${color}`}>
                  {valor}
                </p>
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
      <Card>
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
              <Bar dataKey="manual" fill="#7C3AED" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="auto_mp" fill="#14B8A6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Últimas facturas */}
      <Card className="p-0">
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
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:px-5"
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
