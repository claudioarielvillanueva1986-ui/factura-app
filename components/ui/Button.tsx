import type { ButtonHTMLAttributes } from "react";

type Variant = "brand" | "ghost" | "whatsapp" | "danger";

const VARIANTES: Record<Variant, string> = {
  // El degradé + brillo viven en .btn-sheen (globals.css)
  brand: "btn-sheen text-white disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "bg-surface-2 hover:bg-slate-200 text-text-secondary border border-line",
  whatsapp: "bg-whatsapp hover:brightness-110 text-[#052e16] font-semibold",
  danger: "bg-status-error/15 hover:bg-status-error/25 text-status-error",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "brand", className = "", ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-btn px-4 py-2 text-[13px] font-medium transition-all duration-150 active:scale-[0.97] ${VARIANTES[variant]} ${className}`}
      {...props}
    />
  );
}
