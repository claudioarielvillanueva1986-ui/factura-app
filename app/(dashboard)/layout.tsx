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

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/facturas", label: "Facturas", icon: FileText },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/envios", label: "Envíos WA", icon: MessageCircle },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { user, negocio, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-[200px] flex-col border-r border-line bg-surface">
        <div className="px-5 pb-4 pt-6">
          <Logo size="text-xl" />
          <p className="mt-1 truncate text-[11px] text-text-muted">
            {negocio?.nombre ?? "…"}
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const activo =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
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

      <main className="ml-[200px] flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
