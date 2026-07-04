"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  ShieldCheck,
  CreditCard,
  Download,
  Upload,
  ExternalLink,
  Copy,
  Check,
  Plug,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WizardDelegacion } from "@/components/arca/WizardDelegacion";

type Tab = "negocio" | "arca" | "mercadopago";

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "negocio", label: "Negocio", icon: Building2 },
  { id: "arca", label: "ARCA", icon: ShieldCheck },
  { id: "mercadopago", label: "Mercado Pago", icon: CreditCard },
];

export default function ConfiguracionPage() {
  return (
    <Suspense fallback={null}>
      <Configuracion />
    </Suspense>
  );
}

function Configuracion() {
  const searchParams = useSearchParams();
  // Volver del OAuth de MP aterriza directo en el tab correspondiente
  const [tab, setTab] = useState<Tab>(
    searchParams.get("mp") || searchParams.get("mp_error") ? "mercadopago" : "negocio"
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-[15px] font-semibold">Configuración</h1>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 rounded-btn px-4 py-2 text-[13px] font-medium transition-colors ${
              tab === id
                ? "bg-brand text-white"
                : "border border-line bg-surface text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === "negocio" && <TabNegocio />}
      {tab === "arca" && <TabArca />}
      {tab === "mercadopago" && <TabMercadoPago />}
    </div>
  );
}

/* ============================ Tab Negocio ============================ */

function TabNegocio() {
  const { negocio, refrescar } = useAuth();
  const [form, setForm] = useState({
    nombre: "",
    cuit: "",
    razon_social: "",
    condicion_iva: "monotributo",
    punto_venta: "1",
  });
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (negocio) {
      setForm({
        nombre: negocio.nombre ?? "",
        cuit: negocio.cuit ?? "",
        razon_social: negocio.razon_social ?? "",
        condicion_iva: negocio.condicion_iva ?? "monotributo",
        punto_venta: String(negocio.punto_venta ?? 1),
      });
    }
  }, [negocio]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!negocio) return;
    await supabase
      .from("negocios")
      .update({
        nombre: form.nombre.trim(),
        cuit: form.cuit.replace(/[^\d]/g, "") || null,
        razon_social: form.razon_social.trim() || null,
        condicion_iva: form.condicion_iva,
        punto_venta: parseInt(form.punto_venta) || 1,
      })
      .eq("id", negocio.id);
    setGuardado(true);
    refrescar();
    setTimeout(() => setGuardado(false), 2000);
  }

  return (
    <Card>
      <form onSubmit={guardar} className="space-y-3.5">
        <Input
          id="n-nombre"
          label="Nombre del negocio"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          required
        />
        <Input
          id="n-razon"
          label="Razón social"
          value={form.razon_social}
          onChange={(e) => setForm({ ...form, razon_social: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            id="n-cuit"
            label="CUIT (sin guiones)"
            value={form.cuit}
            onChange={(e) => setForm({ ...form, cuit: e.target.value })}
            placeholder="20123456789"
          />
          <Input
            id="n-pv"
            label="Punto de venta"
            type="number"
            min="1"
            value={form.punto_venta}
            onChange={(e) => setForm({ ...form, punto_venta: e.target.value })}
          />
        </div>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-text-secondary">
            Condición frente al IVA
          </span>
          <select
            value={form.condicion_iva}
            onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })}
            className="w-full rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px]"
          >
            <option value="monotributo">Monotributo (solo factura C)</option>
            <option value="responsable_inscripto">Responsable Inscripto (A/B/C)</option>
          </select>
        </label>
        <Button type="submit">{guardado ? "✓ Guardado" : "Guardar cambios"}</Button>
      </form>
    </Card>
  );
}

/* ============================ Tab ARCA ============================ */

function TabArca() {
  const { negocio, refrescar } = useAuth();
  const modoPropio = negocio?.arca_modo === "certificado_propio";

  async function cambiarModo(modo: "delegado" | "certificado_propio") {
    if (!negocio) return;
    await supabase.from("negocios").update({ arca_modo: modo }).eq("id", negocio.id);
    refrescar();
  }

  return (
    <div className="space-y-4">
      {!modoPropio && <WizardDelegacion />}

      {modoPropio && <CertificadoPropio />}

      {/* Cambio de modo */}
      <details className="rounded-card border border-line bg-surface px-5 py-4">
        <summary className="cursor-pointer text-[12px] text-text-secondary">
          Avanzado: {modoPropio ? "volver al modo simple (delegación)" : "usar certificado propio"}
        </summary>
        <p className="mt-3 text-[12px] text-text-secondary">
          {modoPropio
            ? "El modo simple usa el certificado de facturá.: solo tenés que autorizar nuestro CUIT en ARCA, sin archivos."
            : "Si preferís que la emisión use un certificado digital propio de tu CUIT (en lugar de la autorización a facturá.), podés generarlo acá. Requiere descargar un CSR, subirlo a ARCA y cargar el .crt."}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="mt-3"
          onClick={() => cambiarModo(modoPropio ? "delegado" : "certificado_propio")}
        >
          {modoPropio ? "Usar modo simple" : "Usar certificado propio"}
        </Button>
      </details>
    </div>
  );
}

/* ---------- Modo avanzado: certificado propio (CSR + .crt) ---------- */

function CertificadoPropio() {
  const { negocio, refrescar } = useAuth();
  const [estado, setEstado] = useState({ tiene_clave: false, tiene_cert: false });
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const verificado = Boolean(negocio?.arca_verificado_en);

  async function onProbar() {
    setProbando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/arca/probar", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "La prueba falló");
      setResultado({ ok: true, texto: data.detalle ?? "Conexión OK" });
      refrescar();
    } catch (err) {
      setResultado({
        ok: false,
        texto: err instanceof Error ? err.message : "La prueba falló",
      });
    } finally {
      setProbando(false);
    }
  }

  const cargarEstado = useCallback(async () => {
    const res = await fetch("/api/arca/certificado");
    if (res.ok) setEstado(await res.json());
  }, []);

  useEffect(() => {
    cargarEstado();
  }, [cargarEstado]);

  async function generarCSR() {
    setError(null);
    setMensaje(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/arca/generar-csr", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "No se pudo generar el CSR");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "facturacion.csr";
      a.click();
      URL.revokeObjectURL(url);
      setMensaje("CSR descargado. La clave privada quedó guardada de forma segura.");
      cargarEstado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error generando el CSR");
    } finally {
      setOcupado(false);
    }
  }

  async function subirCert(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError(null);
    setMensaje(null);
    setOcupado(true);
    try {
      const cert_pem = await archivo.text();
      const res = await fetch("/api/arca/certificado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cert_pem }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar el certificado");
      setMensaje("Certificado guardado. Probá la conexión para verificar.");
      cargarEstado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error subiendo el certificado");
    } finally {
      setOcupado(false);
      e.target.value = "";
    }
  }

  const paso1Ok = estado.tiene_clave;
  const paso3Ok = estado.tiene_cert;

  return (
    <div className="space-y-4">
      <Card>
        <PasoHeader numero={1} titulo="Generá tu solicitud de certificado (CSR)" ok={paso1Ok} />
        <p className="mb-3 text-[12px] text-text-secondary">
          Generamos una clave RSA 2048 y la guardamos cifrada en el servidor (nunca pasa
          por tu navegador). Descargás el archivo{" "}
          <code className="text-accent-light">.csr</code> para presentarlo en ARCA.
        </p>
        <Button onClick={generarCSR} disabled={ocupado} variant={paso1Ok ? "ghost" : "brand"}>
          <Download size={14} />
          {paso1Ok ? "Regenerar CSR (invalida el cert anterior)" : "Generar CSR automáticamente"}
        </Button>
      </Card>

      <Card>
        <PasoHeader numero={2} titulo="Subí el CSR a ARCA" ok={paso3Ok} />
        <ol className="ml-4 list-decimal space-y-1.5 text-[12px] text-text-secondary">
          <li>
            Entrá a{" "}
            <a
              href="https://www.afip.gob.ar/ws/WSAA/wsaa_obtener.asp"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-hover hover:underline"
            >
              ARCA — WSAA: obtener certificado <ExternalLink size={11} />
            </a>{" "}
            con tu Clave Fiscal (nivel 3).
          </li>
          <li>
            Buscá el servicio <strong>“Administración de Certificados Digitales”</strong>.
          </li>
          <li>
            Creá un alias nuevo: te sugerimos{" "}
            <code className="rounded bg-[#1A2235] px-1.5 py-0.5 text-accent-light">facturacion</code>.
          </li>
          <li>Subí el archivo <code className="text-accent-light">facturacion.csr</code> del paso 1.</li>
          <li>Descargá el certificado <code className="text-accent-light">.crt</code> que te genera ARCA.</li>
          <li>
            En <strong>“Administrador de Relaciones de Clave Fiscal”</strong>, asociá el
            alias al servicio <strong>“Facturación Electrónica”</strong> (wsfe).
          </li>
        </ol>
      </Card>

      <Card>
        <PasoHeader numero={3} titulo="Subí el certificado (.crt)" ok={paso3Ok} />
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-btn px-4 py-2 text-[13px] font-medium transition-colors ${
            paso1Ok
              ? "bg-brand text-white hover:bg-brand-hover"
              : "cursor-not-allowed bg-white/5 text-text-muted"
          }`}
        >
          <Upload size={14} />
          {paso3Ok ? "Reemplazar certificado" : "Subir archivo .crt"}
          <input
            type="file"
            accept=".crt,.pem,.cer"
            className="hidden"
            disabled={!paso1Ok || ocupado}
            onChange={subirCert}
          />
        </label>
        {!paso1Ok && (
          <p className="mt-2 text-[11px] text-text-muted">Primero completá el paso 1.</p>
        )}
      </Card>

      <Card>
        <PasoHeader numero={4} titulo="Probá la conexión" ok={verificado} />
        <Button onClick={onProbar} disabled={probando || !paso3Ok}>
          <Plug size={14} />
          {probando ? "Consultando ARCA…" : "Probar conexión"}
        </Button>
        {resultado && (
          <p
            className={`mt-3 rounded-btn px-3 py-2 text-[12px] ${
              resultado.ok
                ? "bg-status-ok/15 text-status-ok"
                : "bg-status-error/15 text-status-error"
            }`}
          >
            {resultado.texto}
          </p>
        )}
      </Card>

      {mensaje && (
        <p className="rounded-btn bg-accent-dim px-3 py-2 text-[12px] text-accent-light">
          {mensaje}
        </p>
      )}
      {error && (
        <p className="rounded-btn bg-status-error/15 px-3 py-2 text-[12px] text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}

function PasoHeader({ numero, titulo, ok }: { numero: number; titulo: string; ok: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
          ok ? "bg-status-ok/20 text-status-ok" : "bg-brand-dim text-brand-hover"
        }`}
      >
        {ok ? <Check size={13} /> : numero}
      </span>
      <h2 className="text-[13px] font-semibold">{titulo}</h2>
    </div>
  );
}

/* ============================ Tab Mercado Pago ============================ */

function TabMercadoPago() {
  const { negocio } = useAuth();
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<{
    conectado: boolean;
    manual: boolean;
    mp_user_id: string | null;
    expira_en: string | null;
    auto_facturar: boolean;
  } | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [guardado, setGuardado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const mpOk = searchParams.get("mp") === "conectado";
  const mpError = searchParams.get("mp_error");

  const cargar = useCallback(async () => {
    if (!negocio) return;
    const { data } = await supabase
      .from("mercadopago_config")
      .select("auto_facturar, access_token, refresh_token, mp_user_id, expira_en")
      .eq("negocio_id", negocio.id)
      .maybeSingle();
    setConfig({
      conectado: Boolean(data?.access_token),
      // Sin refresh_token = token pegado a mano (flujo manual)
      manual: Boolean(data?.access_token) && !data?.refresh_token,
      mp_user_id: data?.mp_user_id ?? null,
      expira_en: data?.expira_en ?? null,
      auto_facturar: data?.auto_facturar ?? false,
    });
  }, [negocio]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function toggleAutoFacturar() {
    if (!negocio || !config) return;
    const nuevo = !config.auto_facturar;
    setConfig({ ...config, auto_facturar: nuevo });
    await supabase.from("mercadopago_config").upsert({
      negocio_id: negocio.id,
      auto_facturar: nuevo,
      updated_at: new Date().toISOString(),
    });
  }

  async function guardarTokenManual(e: React.FormEvent) {
    e.preventDefault();
    if (!negocio || !accessToken.trim()) return;
    await supabase.from("mercadopago_config").upsert({
      negocio_id: negocio.id,
      access_token: accessToken.trim(),
      refresh_token: null,
      updated_at: new Date().toISOString(),
    });
    setAccessToken("");
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2000);
    cargar();
  }

  const webhookUrlManual = negocio
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "")}/api/mp/webhook/${negocio.id}`
    : "";

  async function copiar() {
    await navigator.clipboard.writeText(webhookUrlManual);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="space-y-4">
      {mpOk && (
        <div className="rounded-card border border-status-ok/30 bg-status-ok/10 px-4 py-3 text-[13px] text-status-ok">
          ✓ ¡Cuenta de Mercado Pago conectada! Los pagos ya llegan a facturá.
        </div>
      )}
      {mpError && (
        <div className="rounded-card border border-status-error/30 bg-status-error/10 px-4 py-3 text-[13px] text-status-error">
          No se pudo conectar con Mercado Pago
          {mpError === "config" && " (la plataforma no tiene configurado MP_CLIENT_ID)"}
          . Probá de nuevo o contactá a soporte.
        </div>
      )}

      {/* Conexión OAuth */}
      <Card>
        <h2 className="mb-2 text-[13px] font-semibold">Cuenta de Mercado Pago</h2>

        {config?.conectado && !config.manual ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] text-status-ok">
              <Check size={15} />
              Cuenta conectada
              {config.mp_user_id && (
                <span className="text-text-muted">(ID {config.mp_user_id})</span>
              )}
            </div>
            {config.expira_en && (
              <p className="text-[11px] text-text-muted">
                Autorización válida hasta el{" "}
                {new Date(config.expira_en).toLocaleDateString("es-AR")} — se renueva
                sola.
              </p>
            )}
            <a
              href="/api/mp/oauth/conectar"
              className="inline-flex items-center gap-2 rounded-btn border border-line bg-white/5 px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-white/10"
            >
              <RefreshCw size={14} />
              Reconectar cuenta
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-text-secondary">
              Conectá tu cuenta con un click: te llevamos a Mercado Pago, iniciás sesión,
              autorizás y listo. Sin copiar credenciales ni configurar nada más.
            </p>
            <a
              href="/api/mp/oauth/conectar"
              className="inline-flex items-center gap-2 rounded-btn bg-[#009EE3] px-4 py-2.5 text-[13px] font-semibold text-white transition-all hover:brightness-110"
            >
              <Plug size={15} />
              Conectar con Mercado Pago
            </a>
            {config?.manual && (
              <p className="text-[11px] text-status-warn">
                Ahora estás usando un Access Token manual. Al conectar por acá pasás al
                modo automático (recomendado).
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Auto-facturación */}
      <Card>
        <label className="flex cursor-pointer items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">Facturación automática</p>
            <p className="text-[11px] text-text-muted">
              Cada pago aprobado genera y emite la factura solo.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config?.auto_facturar ?? false}
            onClick={toggleAutoFacturar}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              config?.auto_facturar ? "bg-brand" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                config?.auto_facturar ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </label>
      </Card>

      {/* Modo manual (avanzado) */}
      <details className="rounded-card border border-line bg-surface px-5 py-4">
        <summary className="cursor-pointer text-[12px] text-text-secondary">
          Avanzado: usar un Access Token manual
        </summary>
        <form onSubmit={guardarTokenManual} className="mt-4 space-y-3">
          <Input
            id="mp-token"
            label="Access Token de producción"
            type="password"
            placeholder="APP_USR-…"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            autoComplete="off"
          />
          <p className="text-[11px] text-text-muted">
            Lo encontrás en Mercado Pago → Tus integraciones → Credenciales de
            producción. Con este modo tenés que configurar el webhook a mano:
          </p>
          {config?.manual && webhookUrlManual && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[12px] text-accent-light">
                {webhookUrlManual}
              </code>
              <Button type="button" variant="ghost" onClick={copiar}>
                {copiado ? <Check size={14} /> : <Copy size={14} />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
          )}
          <Button type="submit" variant="ghost" disabled={!accessToken.trim()}>
            {guardado ? "✓ Guardado" : "Guardar token manual"}
          </Button>
        </form>
      </details>
    </div>
  );
}
