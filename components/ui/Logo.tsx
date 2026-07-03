export function Logo({ size = "text-2xl" }: { size?: string }) {
  return (
    <span className={`${size} font-bold tracking-tight text-text-primary`}>
      facturá<span className="text-brand">.</span>
    </span>
  );
}
