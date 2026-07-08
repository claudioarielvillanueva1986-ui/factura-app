"use client";

import { useEffect, useRef, useState } from "react";

// Anima un número desde 0 hasta el valor final (count-up con easeOutCubic).
// Respeta prefers-reduced-motion. Recibe un formateador para poder mostrar
// pesos, cantidades, etc. sin acoplar formato.
export function Contador({
  value,
  format,
  durMs = 850,
  className = "",
}: {
  value: number;
  format: (n: number) => string;
  durMs?: number;
  className?: string;
}) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  const desde = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVal(value);
      return;
    }

    const inicio = performance.now();
    const from = desde.current;
    const tick = (t: number) => {
      const p = Math.min(1, (t - inicio) / durMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (value - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else desde.current = value;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      desde.current = value;
    };
  }, [value, durMs]);

  return <span className={className}>{format(val)}</span>;
}
