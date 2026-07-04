"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  MessageCircle,
  Settings,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { Logo } from "@/components/ui/Logo";
import { Splash } from "@/components/ui/Splash";

const NAV = [
  { href: "/", label: "Dashboard", corto: "Inicio", icon: LayoutDashboard },
  { href: "/facturas", label: "Facturas", corto: "Facturas", icon: FileText },
  { href: "/clientes", label: "Clientes", corto: "Clientes", icon: Users },
  { href: "/envios", label: "Envíos WA", corto: "Envíos", icon: MessageCircle },
  { href: "/configuracion", label: "Configuración", corto: "Config", icon: Settings },
];

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { user, negocio, loading, logout } = useAuth();

  // Splash mientras se resuelve la sesión: evita el flash de layout vacío
  if (loading) return <Splash />;

  const esActivo = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="min-h-screen">
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[200px] flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 pb-4 pt-6">
          <Logo size="text-xl" />
          <p className="mt-1 truncate text-[11px] text-text-muted">
            {negocio?.nombre ?? "…"}
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const activo = esActivo(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-5 py-2 text-[13px] transition-colors ${
                  activo
                    ? "border-r-2 border-brand bg-brand-dim font-medium text-text-primary"
                    : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                }`}
              >
                <Icon size={16} strokeWidth={activo ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-5 py-4">
          <p className="mb-2 truncate text-[11px] text-text-muted">{user?.email}</p>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-[12px] text-text-secondary transition-colors hover:text-status-error"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ---------- Header (mobile) ---------- */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="min-w-0">
          <Logo size="text-lg" />
          <p className="truncate text-[10px] leading-tight text-text-muted">
            {negocio?.nombre ?? "…"}
          </p>
        </div>
        <button
          onClick={logout}
          aria-label="Cerrar sesión"
          className="rounded-btn p-2 text-text-secondary transition-colors hover:text-status-error"
        >
          <LogOut size={17} />
        </button>
      </header>

      {/* ---------- Contenido ---------- */}
      <main className="px-4 pb-24 pt-5 md:ml-[200px] md:px-8 md:pb-8 md:pt-7">
        {children}
      </main>

      {/* ---------- Bottom nav (mobile) ---------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map(({ href, corto, icon: Icon }) => {
          const activo = esActivo(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                activo ? "font-medium text-brand-hover" : "text-text-muted"
              }`}
            >
              <Icon size={20} strokeWidth={activo ? 2.2 : 1.7} />
              {corto}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
