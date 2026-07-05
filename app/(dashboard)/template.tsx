// Template de segmento: se re-monta en cada navegación dentro del dashboard,
// disparando la animación de entrada de página (el layout con la sidebar y
// la bottom nav persiste, solo transiciona el contenido).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
