// Skeletons con shimmer: reemplazan a los spinners en listas y stats para
// que la carga se sienta parte del layout y no una interrupción.

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} />;
}

// Filas de lista (avatar + dos líneas + monto), como las reales.
export function SkeletonLista({ filas = 4 }: { filas?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: filas }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 sm:px-5"
          style={{ opacity: 1 - i * 0.18 }}
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="hidden h-5 w-14 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

// Barras fantasma para el gráfico del dashboard.
const ALTURAS_BARRAS = [45, 70, 30, 85, 55, 95, 62];

export function SkeletonGrafico() {
  return (
    <div className="flex h-full items-end justify-around gap-3 px-6 pb-8 pt-4">
      {ALTURAS_BARRAS.map((h, i) => (
        <Skeleton
          key={i}
          className="w-7 rounded-t-md"
          style={{ height: `${h}%`, opacity: 0.5 + (i % 3) * 0.15 }}
        />
      ))}
    </div>
  );
}
