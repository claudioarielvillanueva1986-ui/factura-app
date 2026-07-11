import type { MetadataRoute } from "next";

// Web App Manifest → Next lo sirve en /manifest.webmanifest. Habilita instalar
// facturá. como app (Android/Chrome e iOS "Agregar a inicio").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "facturá. — Facturación electrónica",
    short_name: "facturá.",
    description:
      "Facturación electrónica argentina: ARCA, Mercado Pago y monotributo, en una app simple.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F7FB",
    theme_color: "#FFFFFF",
    lang: "es-AR",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
