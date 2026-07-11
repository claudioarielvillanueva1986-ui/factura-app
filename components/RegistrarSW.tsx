"use client";

import { useEffect } from "react";

// Registra el service worker (necesario para instalar la PWA en Android/Chrome).
export function RegistrarSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* si falla, la app sigue funcionando igual */
      });
    }
  }, []);
  return null;
}
