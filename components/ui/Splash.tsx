import { Logo } from "@/components/ui/Logo";

// Splash de marca: glow violeta difuso detrás del logo, entrada suave y
// barra de progreso con gradiente brand→accent en loop.
export function Splash() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-bg">
      {/* Glow de fondo */}
      <div className="pointer-events-none absolute h-[420px] w-[420px] animate-glow rounded-full bg-brand/25 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-[300px] w-[300px] rounded-full bg-accent/10 blur-[120px]" />

      <div className="relative flex flex-col items-center gap-7">
        <div className="animate-splash-logo">
          <Logo size="text-4xl" />
        </div>
        <div className="h-[3px] w-36 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/3 animate-splash-bar rounded-full bg-gradient-to-r from-brand to-accent" />
        </div>
      </div>
    </div>
  );
}
