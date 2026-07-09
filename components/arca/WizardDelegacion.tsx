"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Copy,
  Check,
  Plug,
  Store,
  KeyRound,
  ListChecks,
  UserCheck,
  PartyPopper,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Onboarding de clientes: delegación del web service de Facturación
// Electrónica al computador fiscal de la plataforma. Cada paso abre la
// pantalla de ARCA en una pestaña nueva (ARCA no permite iframes) y los
// valores a ingresar se copian con un click — el cliente no tipea nada.
//
// Las URLs de ARCA cambian poco pero conviene tenerlas en un solo lugar:
const ARCA_URLS = {
  login: "https://auth.afip.gob.ar/contribuyente_/login.xhtml",
  portal: "https://portalcf.cloud.afip.gob.ar/portal/app/",
};

// TODO: reemplazar los mocks CSS por capturas reales en /public/arca/*.png
// cuando las tengamos (el layout ya las contempla).

const CUIT_PLATAFORMA = process.env.NEXT_PUBLIC_PLATAFORMA_CUIT ?? "";
const ALIAS_PLATAFORMA = process.env.NEXT_PUBLIC_PLATAFORMA_ALIAS ?? "factura-prod";

const TOTAL_PASOS = 5;

export function WizardDelegacion() {
  const { negocio, refrescar } = useAuth();
  const [hechos, setHechos] = useState<Record<number, boolean>>({});
  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [puntoVenta, setPuntoVenta] = useState("");
  const [pvGuardado, setPvGuardado] = useState(false);
  // Permite volver a ver/rehacer los pasos aunque ya figure "verificado"
  // (ej: la delegación quedó sobre el servicio equivocado y hay que corregirla).
  const [rehacer, setRehacer] = useState(false);

  const storageKey = negocio ? `factura_arca_wizard_${negocio.id}` : null;
  const verificado = Boolean(negocio?.arca_verificado_en);

  // El cliente va a ir y volver entre pestañas de ARCA: persistimos el
  // progreso localmente para que no pierda dónde estaba.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHechos(JSON.parse(raw));
    } catch {
      /* sin progreso guardado */
    }
  }, [storageKey]);

  useEffect(() => {
    if (negocio) setPuntoVenta(String(negocio.punto_venta ?? ""));
  }, [negocio]);

  const marcar = useCallback(
    (paso: number, valor: boolean) => {
      setHechos((prev) => {
        const nuevo = { ...prev, [paso]: valor };
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify(nuevo));
        return nuevo;
      });
    },
    [storageKey]
  );

  async function guardarPuntoVenta() {
    if (!negocio) return;
    const pv = parseInt(puntoVenta);
    if (!pv || pv < 1) return;
    await supabase.from("negocios").update({ punto_venta: pv }).eq("id", negocio.id);
    setPvGuardado(true);
    marcar(4, true);
    refrescar();
    setTimeout(() => setPvGuardado(false), 2000);
  }

  async function verificar() {
    setVerificando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/arca/probar", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "La verificación falló");
      setResultado({ ok: true, texto: data.detalle ?? "¡Conexión verificada!" });
      marcar(5, true);
      refrescar();
    } catch (err) {
      setResultado({
        ok: false,
        texto: err instanceof Error ? err.message : "La verificación falló",
      });
    } finally {
      setVerificando(false);
    }
  }

  const completados = Object.values(hechos).filter(Boolean).length;

  if (verificado && !rehacer) {
    return (
      <Card glass className="animate-fade-up space-y-3 text-center">
        <PartyPopper size={36} className="mx-auto text-status-ok" />
        <div>
          <h2 className="text-[15px] font-semibold">¡ARCA conectado!</h2>
          <p className="mt-1 text-[12px] text-text-secondary">
            Autorización verificada el{" "}
            {new Date(negocio!.arca_verificado_en!).toLocaleDateString("es-AR")}. Ya podés
            emitir facturas electrónicas con CAE.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={verificar} disabled={verificando} variant="ghost">
            <Plug size={14} />
            {verificando ? "Consultando ARCA…" : "Volver a verificar"}
          </Button>
          <Button
            onClick={() => {
              setHechos({});
              if (storageKey) localStorage.removeItem(storageKey);
              setResultado(null);
              setRehacer(true);
            }}
            variant="ghost"
          >
            <RefreshCw size={14} />
            Corregir / rehacer la delegación
          </Button>
        </div>
        {resultado && (
          <p
            className={`rounded-btn px-3 py-2 text-[12px] ${
              resultado.ok
                ? "bg-status-ok/15 text-status-ok"
                : "bg-status-error/15 text-status-error"
            }`}
          >
            {resultado.texto}
          </p>
        )}
        <p className="text-[11px] text-text-muted">
          Si las facturas te dan error de autorización, la delegación pudo haber quedado sobre
          el servicio equivocado. Tocá “Corregir / rehacer la delegación” y seguí los pasos de nuevo.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {rehacer && (
        <div className="animate-fade-up rounded-card border border-status-warn/30 bg-status-warn/10 px-4 py-3 text-[12px] text-status-warn">
          <strong>Estás corrigiendo la delegación.</strong> El error más común es haber
          elegido la “Facturación Electrónica” común en vez de la que está dentro de{" "}
          <strong>WebServices</strong> (paso 3), o haber autorizado un CUIT distinto al de
          facturá. (paso 4). Rehacé los pasos con atención y volvé a verificar.
        </div>
      )}

      {/* Intro + progreso */}
      <Card glass className="animate-fade-up space-y-2">
        <h2 className="text-[14px] font-semibold">Conectá tu facturación con ARCA</h2>
        <p className="text-[12px] text-text-secondary">
          Es un trámite de <strong>una sola vez, ~5 minutos</strong>, en el sitio de ARCA.
          No hay que instalar nada ni entender términos técnicos: te abrimos cada pantalla
          y te damos los datos listos para pegar. Vas a necesitar tu{" "}
          <strong>CUIT y tu Clave Fiscal</strong>.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${(completados / TOTAL_PASOS) * 100}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-text-muted">
            {completados}/{TOTAL_PASOS}
          </span>
        </div>
      </Card>

      {/* Paso 1 — Entrar a ARCA */}
      <Paso
        numero={1}
        titulo="Entrá a ARCA con tu Clave Fiscal"
        icono={KeyRound}
        hecho={!!hechos[1]}
        onHecho={(v) => marcar(1, v)}
      >
        <p className="text-[12px] text-text-secondary">
          Se abre en una pestaña nueva. Ingresá con tu CUIT y Clave Fiscal (nivel 2 o
          superior) y <strong>dejá esa pestaña abierta</strong>: los próximos pasos siguen ahí.
        </p>
        <BotonArca href={ARCA_URLS.login} texto="Abrir ARCA (iniciar sesión)" />
      </Paso>

      {/* Paso 2 — Administrador de Relaciones */}
      <Paso
        numero={2}
        titulo="Abrí el Administrador de Relaciones"
        icono={ListChecks}
        hecho={!!hechos[2]}
        onHecho={(v) => marcar(2, v)}
      >
        <p className="text-[12px] text-text-secondary">
          En el buscador del portal de ARCA escribí{" "}
          <strong>“Administrador de Relaciones de Clave Fiscal”</strong> y abrilo. Adentro,
          tocá el botón <strong>“Nueva Relación”</strong>.
        </p>
        <MockPantalla titulo="ARCA — Portal">
          <div className="flex items-center gap-2 rounded-btn border border-line bg-black/30 px-3 py-1.5 text-[11px] text-text-muted">
            🔍 administrador de relaciones de clave fiscal
          </div>
          <div className="mt-2 rounded-btn bg-brand/20 px-3 py-1.5 text-[11px] text-brand-hover">
            → Administrador de Relaciones de Clave Fiscal
          </div>
        </MockPantalla>
        <BotonArca href={ARCA_URLS.portal} texto="Abrir el portal de ARCA" />
      </Paso>

      {/* Paso 3 — Elegir el servicio */}
      <Paso
        numero={3}
        titulo="Elegí el servicio a autorizar"
        icono={ListChecks}
        hecho={!!hechos[3]}
        onHecho={(v) => marcar(3, v)}
      >
        <p className="text-[12px] text-text-secondary">
          En “Nueva Relación” → <strong>Buscar</strong>, navegá este camino y seleccioná:
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="rounded-btn bg-[#1A2235] px-2.5 py-1">ARCA</span>
          <span className="text-text-muted">→</span>
          <span className="rounded-btn bg-[#1A2235] px-2.5 py-1">WebServices</span>
          <span className="text-text-muted">→</span>
          <span className="rounded-btn bg-brand-dim px-2.5 py-1 font-medium text-brand-hover">
            Facturación Electrónica
          </span>
        </div>
        <p className="text-[11px] text-text-muted">
          Ojo: es la que está adentro de <strong>WebServices</strong>, no la “Facturación
          Electrónica” común (esa es para facturar a mano en la web de ARCA).
        </p>
      </Paso>

      {/* Paso 4 — Autorizar a facturá. */}
      <Paso
        numero={4}
        titulo="Autorizá a facturá. como representante"
        icono={UserCheck}
        hecho={!!hechos[4]}
        onHecho={(v) => marcar(4, v)}
      >
        <p className="text-[12px] text-text-secondary">
          En la pantalla de la relación, tocá <strong>“Buscar”</strong> en la fila{" "}
          <strong>Representante</strong>. Elegí la opción{" "}
          <strong>“Computador Fiscal”</strong> (así se le dice al sistema de un tercero) y
          pegá estos dos datos:
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <ChipCopiable etiqueta="CUIT de facturá." valor={CUIT_PLATAFORMA} />
          <ChipCopiable etiqueta="Alias / nombre simbólico" valor={ALIAS_PLATAFORMA} />
        </div>

        <MockPantalla titulo="ARCA — Incorporar Representante">
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-brand">
                <span className="h-2 w-2 rounded-full bg-brand" />
              </span>
              <span className="text-text-primary">Computador Fiscal</span>
              <span className="ml-3 h-3.5 w-3.5 rounded-full border border-line" />
              <span className="text-text-muted">Persona</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-text-muted">CUIT</span>
              <span className="rounded border border-line bg-black/30 px-2 py-0.5 tabular-nums">
                {CUIT_PLATAFORMA || "———"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-text-muted">Alias</span>
              <span className="rounded border border-line bg-black/30 px-2 py-0.5">
                {ALIAS_PLATAFORMA}
              </span>
            </div>
            <div className="pt-1">
              <span className="rounded bg-brand px-3 py-1 text-[10px] font-semibold text-white">
                CONFIRMAR
              </span>
            </div>
          </div>
        </MockPantalla>

        <p className="text-[11px] text-text-muted">
          Al confirmar, ARCA te muestra un comprobante de la relación. Con eso ya está: no
          compartiste tu clave con nadie, solo autorizaste a facturá. a{" "}
          <strong>emitir comprobantes tuyos</strong> (podés revocarlo cuando quieras desde
          el mismo Administrador de Relaciones).
        </p>
      </Paso>

      {/* Paso 5 — Punto de venta */}
      <Paso
        numero={5}
        titulo="Creá tu punto de venta para web services"
        icono={Store}
        hecho={!!hechos[5] || pvGuardado}
        onHecho={(v) => marcar(5, v)}
      >
        <p className="text-[12px] text-text-secondary">
          En el portal de ARCA buscá{" "}
          <strong>“Administración de puntos de venta y domicilios”</strong> → “A/B/M de
          puntos de venta” → agregá uno nuevo eligiendo el sistema:
        </p>
        <ChipCopiable
          etiqueta="Sistema a elegir (monotributo)"
          valor="Factura Electronica - Monotributo - Web Services"
        />
        <p className="text-[11px] text-text-muted">
          (Si sos Responsable Inscripto, la opción se llama “RECE para aplicativo y web
          services”.) Anotá el <strong>número</strong> que te asigna y cargalo acá:
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            placeholder="N°"
            className="w-24 rounded-btn border border-line bg-[#1A2235] px-3 py-2 text-[13px] tabular-nums"
          />
          <Button type="button" variant="ghost" onClick={guardarPuntoVenta}>
            {pvGuardado ? <Check size={14} /> : null}
            {pvGuardado ? "Guardado" : "Guardar punto de venta"}
          </Button>
        </div>
        <BotonArca href={ARCA_URLS.portal} texto="Abrir el portal de ARCA" />
      </Paso>

      {/* Verificación final */}
      <Card glass className="animate-fade-up space-y-3 border-brand/30 shadow-glow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-dim text-[12px] font-semibold text-brand-hover">
            ✓
          </span>
          <h3 className="text-[13px] font-semibold">¿Ya autorizaste? Verificá la conexión</h3>
        </div>
        <p className="text-[12px] text-text-secondary">
          Hacemos una consulta real a ARCA con tu CUIT. Si todo está bien, quedás listo
          para emitir.
        </p>
        <Button onClick={verificar} disabled={verificando} className="w-full py-2.5">
          <Plug size={15} />
          {verificando ? "Consultando ARCA…" : "Ya autoricé — Verificar conexión"}
        </Button>
        {resultado && (
          <div
            className={`rounded-btn px-3 py-2 text-[12px] ${
              resultado.ok
                ? "bg-status-ok/15 text-status-ok"
                : "bg-status-error/15 text-status-error"
            }`}
          >
            {resultado.texto}
            {!resultado.ok && (
              <p className="mt-1 text-[11px] opacity-80">
                💡 La autorización de ARCA puede tardar <strong>hasta 24 hs</strong> en
                impactar. Si acabás de hacer el trámite y todo lo demás está bien, probá de
                nuevo más tarde — tu progreso queda guardado.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- piezas ---------- */

function Paso({
  numero,
  titulo,
  icono: Icono,
  hecho,
  onHecho,
  children,
}: {
  numero: number;
  titulo: string;
  icono: typeof KeyRound;
  hecho: boolean;
  onHecho: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card
      glass
      className={`animate-fade-up space-y-3 transition-opacity ${hecho ? "opacity-70" : ""}`}
      style={{ animationDelay: `${numero * 50}ms` }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
            hecho ? "bg-status-ok/20 text-status-ok" : "bg-brand-dim text-brand-hover"
          }`}
        >
          {hecho ? <Check size={13} /> : numero}
        </span>
        <Icono size={15} className="text-text-muted" />
        <h3 className="flex-1 text-[13px] font-semibold">{titulo}</h3>
        <button
          type="button"
          onClick={() => onHecho(!hecho)}
          className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
            hecho
              ? "bg-status-ok/15 text-status-ok"
              : "bg-white/5 text-text-muted hover:text-text-secondary"
          }`}
        >
          {hecho ? "✓ Hecho" : "Marcar hecho"}
        </button>
      </div>
      {children}
    </Card>
  );
}

function BotonArca({ href, texto }: { href: string; texto: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-btn bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
    >
      <ExternalLink size={14} />
      {texto}
    </a>
  );
}

function ChipCopiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    await navigator.clipboard.writeText(valor);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-btn border border-line bg-[#1A2235] px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">{etiqueta}</p>
        <p className="truncate text-[13px] font-semibold text-accent-light">
          {valor || "— falta configurar —"}
        </p>
      </div>
      <button
        type="button"
        onClick={copiar}
        disabled={!valor}
        className="rounded-btn bg-white/5 p-2 text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary disabled:opacity-40"
        title="Copiar"
      >
        {copiado ? <Check size={14} className="text-status-ok" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// Mini mock ilustrativo de la pantalla de ARCA (hasta tener capturas reales
// en /public/arca/). Es solo referencia visual: ARCA abre en pestaña aparte.
function MockPantalla({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-btn border border-line">
      <div className="flex items-center gap-1.5 border-b border-line bg-black/30 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-2 text-[10px] text-text-muted">{titulo}</span>
        <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted">
          referencia
        </span>
      </div>
      <div className="bg-black/10 p-3">{children}</div>
    </div>
  );
}
