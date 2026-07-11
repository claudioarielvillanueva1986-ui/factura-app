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
  ShieldCheck,
  Landmark,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useEsAdminPlataforma } from "@/lib/useEsAdminPlataforma";
import { Logo } from "@/components/ui/Logo";
import { Splash } from "@/components/ui/Splash";
import { InstalarApp } from "@/components/InstalarApp";

const NAV = [
  { href: "/", label: "Dashboard", corto: "Inicio", icon: LayoutDashboard },
  { href: "/facturas", label: "Facturas", corto: "Facturas", icon: FileText },
  { href: "/monotributo", label: "Mi Monotributo", corto: "Monotrib.", icon: Landmark },
  { href: "/clientes", label: "Clientes", corto: "Clientes", icon: Users },
  { href: "/envios", label: "Envíos WA", corto: "Envíos", icon: MessageCircle },
  { href: "/configuracion", label: "Configuración", corto: "Config", icon: Settings },
];

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { user, negocio, loading, logout } = useAuth();
  const esAdminPlataforma = useEsAdminPlataforma();

  // Splash mientras se resuelve la sesión: evita el flash de layout vacío
  if (loading) return <Splash />;

  const esActivo = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="min-h-[100svh]">
      {/* Fondo ambiente detrás de todo */}
      <div className="bg-ambient" aria-hidden />

      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[200px] flex-col border-r border-line bg-surface/70 backdrop-blur-xl md:flex">
        <div className="px-5 pb-4 pt-6">
          <Logo size="text-xl" />
          <p className="mt-1 truncate text-[11px] text-text-muted">
            {negocio?.nombre ?? "…"}
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const activo = esActivo(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-2.5 rounded-btn px-3 py-2 text-[13px] transition-all duration-200 ${
                  activo
                    ? "bg-gradient-to-r from-brand-dim to-transparent font-medium text-text-primary shadow-glow-sm"
                    : "text-text-secondary hover:bg-slate-100 hover:text-text-primary"
                }`}
              >
                {activo && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-brand-hover to-accent" />
                )}
                <Icon
                  size={16}
                  strokeWidth={activo ? 2.2 : 1.8}
                  className={activo ? "text-brand-hover" : ""}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-5 py-4">
          {esAdminPlataforma && (
            <Link
              href="/admin"
              className="mb-3 flex items-center gap-2 text-[12px] text-brand-hover hover:underline"
            >
              <ShieldCheck size={14} />
              Panel admin
            </Link>
          )}
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
        <div className="flex items-center gap-1">
          {esAdminPlataforma && (
            <Link
              href="/admin"
              aria-label="Panel admin"
              className="rounded-btn p-2 text-brand-hover"
            >
              <ShieldCheck size={17} />
            </Link>
          )}
          <button
            onClick={logout}
            aria-label="Cerrar sesión"
            className="rounded-btn p-2 text-text-secondary transition-colors hover:text-status-error"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {/* ---------- Contenido ---------- */}
      <main className="px-4 pb-24 pt-5 md:ml-[200px] md:px-8 md:pb-8 md:pt-7">
        {children}
      </main>

      <InstalarApp />

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
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors duration-200 ${
                activo ? "font-medium text-brand-hover" : "text-text-muted"
              }`}
            >
              <span
                className={`absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand to-accent transition-opacity duration-200 ${
                  activo ? "opacity-100" : "opacity-0"
                }`}
              />
              <span className="relative">
                {/* halo detrás del ícono activo */}
                <span
                  className={`absolute -inset-2 rounded-full bg-brand/25 blur-md transition-opacity duration-300 ${
                    activo ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span
                  className={`relative block transition-transform duration-200 ${
                    activo ? "-translate-y-px scale-110" : ""
                  }`}
                >
                  <Icon size={20} strokeWidth={activo ? 2.2 : 1.7} />
                </span>
              </span>
              {corto}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
