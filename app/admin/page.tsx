"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  FileText,
  Calendar,
  Ban,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatoPesos, formatoNumeroFactura, type EstadoFactura } from "@/lib/types";
import { EstadoBadge } from "@/components/ui/EstadoBadge";

type EstadoCuenta = "trial" | "activo" | "gracia" | "suspendido" | "cancelado";

// CUIT de la plataforma (dueña del certificado). Es quien debe ACEPTAR en ARCA
// la designación de cada cliente que delega (2° paso del trámite).
const PLATAFORMA_CUIT = process.env.NEXT_PUBLIC_PLATAFORMA_CUIT ?? "de la plataforma";

interface NegocioAdmin {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string | null;
  plan: string;
  estado_cuenta: EstadoCuenta;
  trial_hasta: string | null;
  gracia_hasta: string | null;
  precio_mensual: number | null;
  mp_preapproval_id: string | null;
  notas_admin: string | null;
  created_at: string;
  habilitada: boolean;
  usuarios_count: number;
  facturas_count: number;
  ultimo_pago: { monto: number; estado: string; fecha: string } | null;
  // salud de facturación
  arca_ok: boolean;
  arca_verificado_en: string | null;
  arca_delegado_en: string | null;
  punto_venta: number | null;
  mp_conectado: boolean;
  facturas_emitidas: number;
  facturas_error: number;
  facturas_borrador: number;
  facturas_pendiente_arca: number;
  ultima_emision: string | null;
  primer_error_en: string | null;
  ultimo_error: string | null;
}

const ESTADOS: { id: EstadoCuenta | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "trial", label: "Trial" },
  { id: "activo", label: "Activos" },
  { id: "gracia", label: "En gracia" },
  { id: "suspendido", label: "Suspendidos" },
  { id: "cancelado", label: "Cancelados" },
];

const ESTADO_BADGE: Record<EstadoCuenta, string> = {
  trial: "bg-brand-dim text-brand-hover",
  activo: "bg-status-ok/15 text-status-ok",
  gracia: "bg-status-warn/15 text-status-warn",
  suspendido: "bg-status-error/15 text-status-error",
  cancelado: "bg-slate-100 text-text-secondary",
};

// ISO (UTC) ↔ valor de <input type="datetime-local"> (hora local del navegador).
function isoADatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function datetimeLocalAIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function tiempoRelativo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

// Estimación de la ventana de propagación de ARCA: la delegación puede tardar
// hasta 24 hs desde que se verificó en habilitar la emisión.
function estimacionArca(
  verificadoEn: string | null
): { texto: string; vencido: boolean } | null {
  if (!verificadoEn) return null;
  const transcurridoH = (Date.now() - new Date(verificadoEn).getTime()) / 3_600_000;
  const restanteH = 24 - transcurridoH;
  if (restanteH <= 0) {
    return {
      texto:
        "Ya pasaron más de 24 hs desde la verificación. Si sigue con errores, " +
        "la delegación probablemente quedó sobre el servicio equivocado (tiene que ser " +
        "'Facturación Electrónica' dentro de WebServices) y hay que rehacerla.",
      vencido: true,
    };
  }
  const h = Math.floor(restanteH);
  const m = Math.round((restanteH - h) * 60);
  return {
    texto: `ARCA puede tardar hasta 24 hs en habilitar la emisión. Estimado: faltan ~${h} h ${m} min.`,
    vencido: false,
  };
}

export default function AdminPage() {
  const [negocios, setNegocios] = useState<NegocioAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<EstadoCuenta | "todos">("todos");
  const [soloErrores, setSoloErrores] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_listar_negocios");
    if (!error) setNegocios((data as NegocioAdmin[]) ?? []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    let lista = negocios;
    if (filtro !== "todos") lista = lista.filter((n) => n.estado_cuenta === filtro);
    if (soloErrores) lista = lista.filter((n) => n.facturas_error > 0);
    const q = busqueda.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (n) =>
          n.nombre.toLowerCase().includes(q) ||
          (n.cuit ?? "").includes(q) ||
          (n.razon_social ?? "").toLowerCase().includes(q)
      );
    }
    return lista;
  }, [negocios, filtro, soloErrores, busqueda]);

  const stats = useMemo(
    () => ({
      total: negocios.length,
      activos: negocios.filter((n) => n.estado_cuenta === "activo").length,
      trial: negocios.filter((n) => n.estado_cuenta === "trial").length,
      conErrores: negocios.filter((n) => n.facturas_error > 0).length,
    }),
    [negocios]
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[16px] font-semibold">Negocios de la plataforma</h1>
        <p className="mt-1 text-[12px] text-text-secondary">
          Suscripciones, trials y períodos de gracia de todos los clientes.
        </p>
      </header>

      <CategoriasMonotributoEditor />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card glass hover className="p-4">
          <p className="text-[11px] text-text-muted">Total</p>
          <p className="mt-1 text-[20px] font-semibold tabular-nums">{stats.total}</p>
        </Card>
        <Card glass hover className="p-4">
          <p className="text-[11px] text-text-muted">Activos</p>
          <p className="mt-1 text-[20px] font-semibold tabular-nums text-status-ok">
            {stats.activos}
          </p>
        </Card>
        <Card glass hover className="p-4">
          <p className="text-[11px] text-text-muted">En trial</p>
          <p className="mt-1 text-[20px] font-semibold tabular-nums text-brand-hover">
            {stats.trial}
          </p>
        </Card>
        <button
          type="button"
          onClick={() => setSoloErrores((v) => !v)}
          className="text-left"
        >
          <Card
            glass
            hover
            className={`p-4 ${soloErrores ? "ring-1 ring-status-error/60" : ""}`}
          >
            <p className="text-[11px] text-text-muted">Con errores de facturación</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums text-status-error">
              {stats.conErrores}
            </p>
          </Card>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ESTADOS.map(({ id, label }) => (
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
            placeholder="Nombre, CUIT…"
            className="w-full rounded-btn border border-line bg-surface-2 py-2 pl-8 pr-3 text-[13px] placeholder:text-text-muted"
          />
        </div>
      </div>

      <Card glass className="p-0">
        <div className="divide-y divide-line">
          {visibles.map((n) => (
            <div key={n.id}>
              <button
                onClick={() => setExpandido(expandido === n.id ? null : n.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left sm:px-5"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-[13px] font-medium">{n.nombre}</p>
                  <p className="truncate text-[11px] text-text-muted">
                    {n.cuit ?? "sin CUIT"} · {n.usuarios_count} usuario
                    {n.usuarios_count === 1 ? "" : "s"} · {n.facturas_emitidas} emitida
                    {n.facturas_emitidas === 1 ? "" : "s"}
                  </p>
                </div>
                {n.facturas_error > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-status-error/15 px-2.5 py-0.5 text-[11px] font-medium text-status-error">
                    <AlertTriangle size={11} />
                    {n.facturas_error} con error
                  </span>
                )}
                {n.facturas_pendiente_arca > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-dim px-2.5 py-0.5 text-[11px] font-medium text-brand-hover">
                    <Clock size={11} />
                    {n.facturas_pendiente_arca} esperando ARCA
                  </span>
                )}
                {!n.arca_ok && (
                  <span className="rounded-full bg-status-warn/15 px-2.5 py-0.5 text-[10px] text-status-warn">
                    ARCA sin verificar
                  </span>
                )}
                {n.precio_mensual != null && (
                  <span className="text-[12px] tabular-nums text-text-secondary">
                    {formatoPesos(n.precio_mensual)}
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${ESTADO_BADGE[n.estado_cuenta]}`}
                >
                  {n.estado_cuenta}
                </span>
                {!n.habilitada && (
                  <span className="rounded-full bg-status-error/15 px-2.5 py-0.5 text-[10px] text-status-error">
                    bloqueada
                  </span>
                )}
                {expandido === n.id ? (
                  <ChevronUp size={16} className="text-text-muted" />
                ) : (
                  <ChevronDown size={16} className="text-text-muted" />
                )}
              </button>
              {expandido === n.id && (
                <DetalleNegocio negocio={n} onCambio={cargar} />
              )}
            </div>
          ))}
          {!cargando && visibles.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-text-muted">
              No hay negocios para este filtro.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

// Editor de los topes de las categorías de monotributo (valores de referencia).
// Solo el admin de plataforma puede guardar (RPC security definer).
function CategoriasMonotributoEditor() {
  const [cats, setCats] = useState<
    { categoria: string; limite_anual: number; cuota_mensual: number | null }[]
  >([]);
  const [limites, setLimites] = useState<Record<string, string>>({});
  const [cuotas, setCuotas] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("monotributo_categorias")
      .select("categoria, limite_anual, cuota_mensual")
      .order("orden");
    const lista =
      (data as { categoria: string; limite_anual: number; cuota_mensual: number | null }[]) ?? [];
    setCats(lista);
    setLimites(Object.fromEntries(lista.map((c) => [c.categoria, String(c.limite_anual)])));
    setCuotas(
      Object.fromEntries(lista.map((c) => [c.categoria, c.cuota_mensual != null ? String(c.cuota_mensual) : ""]))
    );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(cat: string) {
    const limite = Number(limites[cat]);
    if (!(limite > 0)) return;
    const cuota = cuotas[cat] ? Number(cuotas[cat]) : null;
    setGuardando(cat);
    setOk(null);
    const { error } = await supabase.rpc("admin_editar_categoria_monotributo", {
      p_categoria: cat,
      p_limite: limite,
      p_cuota: cuota,
    });
    setGuardando(null);
    if (!error) {
      setOk(cat);
      setTimeout(() => setOk(null), 1500);
    }
  }

  return (
    <details className="rounded-card border border-line bg-surface px-5 py-4">
      <summary className="cursor-pointer text-[13px] font-medium text-text-secondary">
        Topes de categorías de monotributo (referencia)
      </summary>
      <p className="mt-2 text-[11px] text-text-muted">
        Cargá los montos oficiales de AFIP: el <strong>tope anual</strong> de facturación y la{" "}
        <strong>cuota mensual</strong> de cada categoría. Alimentan la sección “Mi Monotributo”
        de todos los clientes.
      </p>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-text-muted sm:grid-cols-[auto_1fr_1fr_auto]">
        <span className="hidden sm:block">Cat</span>
        <span className="hidden sm:block">Tope anual</span>
        <span className="hidden sm:block">Cuota mensual</span>
        <span />
      </div>
      <div className="mt-1 space-y-2">
        {cats.map((c) => (
          <div key={c.categoria} className="flex flex-wrap items-center gap-2">
            <span className="w-6 shrink-0 text-[13px] font-semibold text-brand-hover">
              {c.categoria}
            </span>
            <input
              type="number"
              placeholder="tope anual"
              value={limites[c.categoria] ?? ""}
              onChange={(e) => setLimites((v) => ({ ...v, [c.categoria]: e.target.value }))}
              className="min-w-0 flex-1 rounded-btn border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] tabular-nums"
            />
            <input
              type="number"
              placeholder="cuota mensual"
              value={cuotas[c.categoria] ?? ""}
              onChange={(e) => setCuotas((v) => ({ ...v, [c.categoria]: e.target.value }))}
              className="min-w-0 flex-1 rounded-btn border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] tabular-nums"
            />
            <button
              onClick={() => guardar(c.categoria)}
              disabled={guardando === c.categoria}
              className="shrink-0 rounded-btn bg-brand px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {ok === c.categoria ? "✓" : guardando === c.categoria ? "…" : "Guardar"}
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}

function SaludTile({
  label,
  valor,
  tono,
}: {
  label: string;
  valor: number;
  tono: "ok" | "error" | "muted" | "pendiente";
}) {
  const color =
    tono === "ok"
      ? "text-status-ok"
      : tono === "error"
        ? "text-status-error"
        : tono === "pendiente"
          ? "text-brand-hover"
          : "text-text-secondary";
  return (
    <div className="rounded-btn bg-slate-100 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-[16px] font-semibold tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}

interface Pago {
  id: string;
  monto: number;
  estado: string;
  created_at: string;
}

interface FacturaAdmin {
  id: string;
  numero: number;
  tipo: string;
  estado: EstadoFactura;
  origen: string | null;
  total: number;
  fecha: string;
  cae: string | null;
  error_mensaje: string | null;
  cliente_nombre: string | null;
  created_at: string;
}

function DetalleNegocio({
  negocio,
  onCambio,
}: {
  negocio: NegocioAdmin;
  onCambio: () => void;
}) {
  const [trialHasta, setTrialHasta] = useState(negocio.trial_hasta ?? "");
  const [graciaHasta, setGraciaHasta] = useState(negocio.gracia_hasta ?? "");
  const [precio, setPrecio] = useState(String(negocio.precio_mensual ?? ""));
  const [notas, setNotas] = useState(negocio.notas_admin ?? "");
  const [estado, setEstado] = useState<EstadoCuenta>(negocio.estado_cuenta);
  const [delegadoEn, setDelegadoEn] = useState(isoADatetimeLocal(negocio.arca_delegado_en));
  const [guardando, setGuardando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const [facturas, setFacturas] = useState<FacturaAdmin[] | null>(null);

  useEffect(() => {
    supabase
      .rpc("admin_listar_pagos", { p_negocio_id: negocio.id })
      .then(({ data }) => setPagos((data as Pago[]) ?? []));
    supabase
      .rpc("admin_listar_facturas", { p_negocio_id: negocio.id, p_limit: 30 })
      .then(({ data }) => setFacturas((data as FacturaAdmin[]) ?? []));
  }, [negocio.id]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const { error } = await supabase.rpc("admin_actualizar_negocio", {
      p_negocio_id: negocio.id,
      p_trial_hasta: trialHasta || null,
      p_gracia_hasta: graciaHasta || null,
      p_estado_cuenta: estado,
      p_precio_mensual: precio ? Number(precio) : null,
      p_notas_admin: notas || null,
      p_arca_delegado_en: datetimeLocalAIso(delegadoEn),
    });
    setGuardando(false);
    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }
    setMensaje("✓ Guardado");
    onCambio();
  }

  function extenderDias(dias: number) {
    const base = trialHasta ? new Date(`${trialHasta}T00:00:00`) : new Date();
    base.setDate(base.getDate() + dias);
    setTrialHasta(base.toISOString().slice(0, 10));
  }

  function darGracia(dias: number) {
    const base = new Date();
    base.setDate(base.getDate() + dias);
    setGraciaHasta(base.toISOString().slice(0, 10));
    setEstado("gracia");
  }

  async function cancelarSuscripcion() {
    if (!confirm(`¿Cancelar la suscripción de "${negocio.nombre}"? Esto corta el cobro automático.`)) {
      return;
    }
    setCancelando(true);
    try {
      const res = await fetch("/api/admin/suscripcion/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ negocio_id: negocio.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "No se pudo cancelar");
      }
      setMensaje("✓ Suscripción cancelada");
      onCambio();
    } catch (err) {
      setMensaje(err instanceof Error ? `Error: ${err.message}` : "Error al cancelar");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-line bg-slate-50 px-4 py-4 sm:px-5">
      {/* Salud de facturación: ¿está facturando bien? ¿tiene errores? */}
      <div className="rounded-btn border border-line bg-slate-50 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <FileText size={13} />
          Estado de la facturación
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SaludTile label="Emitidas" valor={negocio.facturas_emitidas} tono="ok" />
          <SaludTile label="Con error" valor={negocio.facturas_error} tono={negocio.facturas_error > 0 ? "error" : "muted"} />
          {negocio.facturas_pendiente_arca > 0 ? (
            <SaludTile label="Esperando ARCA" valor={negocio.facturas_pendiente_arca} tono="pendiente" />
          ) : (
            <SaludTile label="Borradores" valor={negocio.facturas_borrador} tono="muted" />
          )}
          <div className="rounded-btn bg-slate-100 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Conexiones</p>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
              <span className={negocio.arca_ok ? "text-status-ok" : "text-status-warn"}>
                {negocio.arca_ok ? "ARCA ✓" : "ARCA ✗"}
              </span>
              <span className={negocio.mp_conectado ? "text-status-ok" : "text-text-muted"}>
                {negocio.mp_conectado ? "MP ✓" : "MP ✗"}
              </span>
            </div>
          </div>
        </div>

        {/* Delegación / verificación de ARCA + estimación de propagación */}
        <div className="mt-2 space-y-1 text-[11px]">
          <p className="text-text-muted">
            Delegación ARCA:{" "}
            {negocio.arca_delegado_en ?? negocio.arca_verificado_en ? (
              <span className="text-text-secondary">
                {new Date(
                  (negocio.arca_delegado_en ?? negocio.arca_verificado_en)!
                ).toLocaleString("es-AR")}{" "}
                · {tiempoRelativo(negocio.arca_delegado_en ?? negocio.arca_verificado_en)}
                {!negocio.arca_delegado_en && " (según verificación)"}
              </span>
            ) : (
              <span className="text-status-warn">todavía no verificó la conexión</span>
            )}
            {negocio.punto_venta ? ` · Pto vta ${negocio.punto_venta}` : ""}
          </p>
          {(negocio.facturas_error > 0 || negocio.facturas_pendiente_arca > 0) &&
            (() => {
              const est = estimacionArca(negocio.arca_delegado_en ?? negocio.arca_verificado_en);
              if (!est) return null;
              return (
                <p
                  className={`rounded-btn px-2.5 py-1.5 ${
                    est.vencido
                      ? "bg-status-error/10 text-status-error"
                      : "bg-brand-dim text-brand-hover"
                  }`}
                >
                  ⏳ {est.texto}
                </p>
              );
            })()}
          {negocio.primer_error_en && (
            <p className="text-text-muted">
              Con errores desde: {new Date(negocio.primer_error_en).toLocaleString("es-AR")} (
              {tiempoRelativo(negocio.primer_error_en)})
            </p>
          )}
          {/* Fecha real de la delegación (ajusta el contador de 24 hs) */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label className="text-text-muted">Delegación hecha el:</label>
            <input
              type="datetime-local"
              value={delegadoEn}
              onChange={(e) => setDelegadoEn(e.target.value)}
              className="rounded-btn border border-line bg-surface-2 px-2 py-1 text-[11px]"
            />
            <span className="text-text-muted">
              (cargá cuándo el cliente terminó el trámite en ARCA — arranca el conteo de 24 hs
              desde acá. Guardá con el botón de abajo.)
            </span>
          </div>
        </div>

        {negocio.ultima_emision && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
            <CheckCircle2 size={12} className="text-status-ok" />
            Última emisión: {new Date(negocio.ultima_emision).toLocaleString("es-AR")}
          </p>
        )}
        {negocio.facturas_error > 0 && negocio.ultimo_error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-btn bg-status-error/10 px-2.5 py-2 text-[11px] text-status-error">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>Último error: {negocio.ultimo_error}</span>
          </p>
        )}
      </div>

      {/* Recordatorio: ARCA requiere que la plataforma ACEPTE la designación
          del cliente (2° paso, del lado nuestro). Sin esto, WSFE rechaza aunque
          el cliente ya haya delegado. Se muestra mientras haya errores/pendientes. */}
      {(negocio.facturas_error > 0 || negocio.facturas_pendiente_arca > 0) && (
        <div className="rounded-btn border border-brand/30 bg-brand-dim px-3 py-3 text-[12px]">
          <p className="flex items-center gap-1.5 font-semibold text-brand-hover">
            <ShieldCheck size={14} />
            ¿Ya lo aceptaste en ARCA?
          </p>
          <p className="mt-1.5 text-text-secondary">
            Delegar tiene <strong>2 pasos</strong>: el cliente delega el servicio (lo hace él),
            y <strong>vos tenés que aceptar la designación</strong> desde la cuenta de ARCA de
            la plataforma (CUIT {PLATAFORMA_CUIT}). Si el cliente ya delegó y sigue con errores,
            casi siempre falta este paso.
          </p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[11px] text-text-muted">
            <li>Entrá a ARCA con la Clave Fiscal de la plataforma (CUIT {PLATAFORMA_CUIT}).</li>
            <li>
              Abrí el servicio <strong>“Aceptación de Designación”</strong> (si no lo tenés,
              adherilo desde Administrador de Relaciones).
            </li>
            <li>
              Aceptá la designación pendiente del CUIT{" "}
              <strong>{negocio.cuit ?? "del cliente"}</strong> para Facturación Electrónica.
            </li>
          </ol>
          <a
            href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-btn bg-brand px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-brand-hover"
          >
            <ExternalLink size={12} />
            Abrir ARCA para aceptar
          </a>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">
            Trial hasta
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={trialHasta}
              onChange={(e) => setTrialHasta(e.target.value)}
              className="w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-[13px]"
            />
            <Button type="button" variant="ghost" onClick={() => extenderDias(7)}>
              +7d
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">
            Gracia hasta
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={graciaHasta}
              onChange={(e) => setGraciaHasta(e.target.value)}
              className="w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-[13px]"
            />
            <Button type="button" variant="ghost" onClick={() => darGracia(3)}>
              <Calendar size={14} />
              +3d
            </Button>
          </div>
        </div>

        <Input
          id={`precio-${negocio.id}`}
          label="Precio mensual (vacío = usar el default de la plataforma)"
          type="number"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          placeholder="9999"
        />

        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-text-secondary">Estado de cuenta</span>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoCuenta)}
            className="w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-[13px]"
          >
            <option value="trial">Trial</option>
            <option value="activo">Activo</option>
            <option value="gracia">En gracia</option>
            <option value="suspendido">Suspendido</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-text-secondary">Notas internas</span>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          placeholder="Ej: pidió 15 días más por viaje, pagó por transferencia el 3/7…"
          className="w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-[13px] placeholder:text-text-muted"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </Button>
        {negocio.mp_preapproval_id && negocio.estado_cuenta !== "cancelado" && (
          <Button variant="danger" onClick={cancelarSuscripcion} disabled={cancelando}>
            <Ban size={14} />
            {cancelando ? "Cancelando…" : "Cancelar suscripción (a pedido del cliente)"}
          </Button>
        )}
        {mensaje && <span className="text-[12px] text-text-secondary">{mensaje}</span>}
      </div>

      {/* Últimas facturas del cliente (para ayudarlo/diagnosticar) */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <FileText size={13} />
          Últimas facturas del cliente
        </p>
        {facturas === null ? (
          <p className="text-[12px] text-text-muted">Cargando…</p>
        ) : facturas.length === 0 ? (
          <p className="text-[12px] text-text-muted">Este cliente todavía no generó facturas.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-btn border border-line">
            {facturas.map((f) => {
              const tieneCae = Boolean(f.cae) && (f.estado === "emitida" || f.estado === "enviada");
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50 px-3 py-2 text-[12px]">
                  <span className="w-[70px] shrink-0 tabular-nums text-text-secondary">
                    {formatoNumeroFactura(f.tipo as "A" | "B" | "C", f.numero, negocio.punto_venta ?? 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-muted">
                    {f.cliente_nombre ?? "Consumidor Final"} ·{" "}
                    {new Date(`${f.fecha}T00:00:00`).toLocaleDateString("es-AR")}
                  </span>
                  <span className="tabular-nums font-medium">{formatoPesos(Number(f.total))}</span>
                  <EstadoBadge estado={f.estado} />
                  {tieneCae && (
                    <a
                      href={`/api/facturas/${f.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      title="Ver PDF"
                      className="text-brand-hover hover:underline"
                    >
                      PDF
                    </a>
                  )}
                  {f.estado === "borrador" && f.error_mensaje && (
                    <span className="w-full text-[11px] text-brand-hover">⏳ {f.error_mensaje}</span>
                  )}
                  {f.estado === "error" && f.error_mensaje && (
                    <span className="w-full text-[11px] text-status-error">⚠ {f.error_mensaje}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <FileText size={13} />
          Historial de pagos
        </p>
        {pagos === null ? (
          <p className="text-[12px] text-text-muted">Cargando…</p>
        ) : pagos.length === 0 ? (
          <p className="text-[12px] text-text-muted">Todavía no hay pagos registrados.</p>
        ) : (
          <div className="space-y-1">
            {pagos.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-btn bg-slate-100 px-3 py-1.5 text-[12px]"
              >
                <span className="text-text-secondary">
                  {new Date(p.created_at).toLocaleDateString("es-AR")}
                </span>
                <span className="tabular-nums">{formatoPesos(p.monto)}</span>
                <span className="text-text-muted">{p.estado}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
