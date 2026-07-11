import type { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", id, ...props }: Props) {
  const input = (
    <input
      id={id}
      className={`w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted transition-colors ${className}`}
      {...props}
    />
  );

  if (!label) return input;

  return (
    <label className="block space-y-1.5" htmlFor={id}>
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {input}
    </label>
  );
}
