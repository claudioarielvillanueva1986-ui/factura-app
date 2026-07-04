import { Logo } from "@/components/ui/Logo";

// Pantalla de carga a pantalla completa (splash) — se usa mientras se
// resuelve la sesión y en las transiciones de ruta.
export function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg">
      <div className="animate-pulse">
        <Logo size="text-3xl" />
      </div>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 animate-splash rounded-full bg-brand" />
      </div>
    </div>
  );
}
