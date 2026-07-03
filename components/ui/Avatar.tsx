import { iniciales } from "@/lib/types";

export function Avatar({ nombre, auto = false }: { nombre: string; auto?: boolean }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
        auto ? "bg-accent-dim text-accent-light" : "bg-brand-dim text-brand-hover"
      }`}
    >
      {iniciales(nombre)}
    </div>
  );
}
