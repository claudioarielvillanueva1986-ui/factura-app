import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  // Superficie con borde-gradiente + vidrio (para cards destacadas)
  glass?: boolean;
  // Elevación springy al pasar el mouse
  hover?: boolean;
}

export function Card({ className = "", glass = false, hover = false, ...props }: CardProps) {
  const base = glass
    ? "surface-ring card-glass border border-line/60"
    : "border border-line bg-surface";
  return (
    <div
      className={`rounded-card p-5 ${base} ${hover ? "hover-lift" : ""} ${className}`}
      {...props}
    />
  );
}
