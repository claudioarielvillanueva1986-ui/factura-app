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
        bg: "#0B0F1A",
        surface: "#141927",
        "surface-2": "#1A2235",
        brand: {
          DEFAULT: "#7C3AED",
          hover: "#8B5CF6",
          dim: "rgba(124, 58, 237, 0.15)",
        },
        accent: {
          DEFAULT: "#14B8A6",
          light: "#5EEAD4",
          dim: "rgba(20, 184, 166, 0.15)",
        },
        "text-primary": "#F1F5F9",
        "text-secondary": "#94A3B8",
        "text-muted": "#64748B",
        "status-ok": "#22C55E",
        "status-error": "#EF4444",
        "status-warn": "#F59E0B",
        whatsapp: "#25D366",
        line: "rgba(255, 255, 255, 0.07)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
