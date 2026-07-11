"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISS_KEY = "factura_pwa_dismissed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromptEvent = any;

// Sugiere instalar facturá. como app. En Android usa el prompt nativo
// (beforeinstallprompt); en iPhone muestra los pasos (Compartir → Agregar a
// inicio), porque Safari no expone un prompt programático. Se puede cerrar y
// no vuelve a aparecer. No se muestra si ya está instalada (standalone).
export function InstalarApp() {
  const [visible, setVisible] = useState(false);
  const [esIOS, setEsIOS] = useState(false);
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error - Safari iOS
      window.navigator.standalone === true;
    if (standalone) return;

    let descartado = false;
    try {
      descartado = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* sin storage */
    }
    if (descartado) return;

    const ua = window.navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    setEsIOS(ios);

    if (ios) {
      // iOS no dispara beforeinstallprompt: mostramos los pasos directamente.
      setVisible(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function cerrar() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sin storage */
    }
  }

  async function instalar() {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice?.catch(() => {});
    cerrar();
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-[76px] z-40 px-4 md:bottom-6 md:left-auto md:right-6 md:px-0">
      <div className="surface-ring card-glass mx-auto flex max-w-md items-center gap-3 rounded-card border border-line/60 p-3.5 shadow-glow md:mx-0">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-brand-dim">
          <Download size={18} className="text-brand-hover" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Instalá facturá. en tu teléfono</p>
          {esIOS ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-secondary">
              Tocá <Share size={12} className="inline" /> Compartir → “Agregar a inicio”.
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-text-secondary">
              Abrila como app, sin la barra del navegador.
            </p>
          )}
        </div>
        {!esIOS && (
          <button
            onClick={instalar}
            className="shrink-0 rounded-btn bg-brand px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-hover"
          >
            Instalar
          </button>
        )}
        <button
          onClick={cerrar}
          aria-label="Cerrar"
          className="shrink-0 rounded-btn p-1.5 text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
