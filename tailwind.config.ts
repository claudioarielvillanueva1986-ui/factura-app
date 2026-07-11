import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tema claro — fondo casi blanco, tarjetas blancas, azul confianza.
        bg: "#F5F7FB",
        surface: "#FFFFFF",
        "surface-2": "#EEF2F8",
        brand: {
          DEFAULT: "#2563EB",
          hover: "#1D4ED8",
          dim: "rgba(37, 99, 235, 0.10)",
        },
        accent: {
          DEFAULT: "#10B981",
          light: "#059669",
          dim: "rgba(16, 185, 129, 0.12)",
        },
        "text-primary": "#0F172A",
        "text-secondary": "#475569",
        "text-muted": "#94A3B8",
        "status-ok": "#16A34A",
        "status-error": "#DC2626",
        "status-warn": "#D97706",
        whatsapp: "#25D366",
        line: "rgba(15, 23, 42, 0.09)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
      boxShadow: {
        // Sombras suaves grises/azules para tema claro (elevación real sobre blanco)
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 20px -12px rgba(15, 23, 42, 0.12)",
        glow: "0 12px 32px -16px rgba(37, 99, 235, 0.30)",
        "glow-sm": "0 6px 18px -10px rgba(37, 99, 235, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
