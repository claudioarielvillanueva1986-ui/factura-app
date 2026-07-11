// Spinner para listas y secciones que están trayendo datos.
export function Cargando({ className = "py-10" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand" />
    </div>
  );
}
