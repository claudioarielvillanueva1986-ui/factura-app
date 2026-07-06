"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useEsAdminPlataforma } from "@/lib/useEsAdminPlataforma";
import { Logo } from "@/components/ui/Logo";
import { Splash } from "@/components/ui/Splash";

// Sección aparte del dashboard por negocio: acá se administran TODOS los
// negocios de la plataforma. Gate doble: sesión (middleware) + admin de
// plataforma (chequeado acá, vía RPC con RLS propia).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const esAdmin = useEsAdminPlataforma();
  const router = useRouter();

  if (loading) return <Splash />;

  if (!user) {
    router.replace("/login");
    return <Splash />;
  }

  if (!esAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert size={36} className="text-status-error" />
        <p className="text-[13px] text-text-secondary">
          No tenés acceso al panel de administración de la plataforma.
        </p>
        <Link href="/" className="text-[12px] text-brand-hover hover:underline">
          Volver al dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Logo size="text-lg" />
          <span className="rounded-full bg-brand-dim px-2.5 py-0.5 text-[11px] font-medium text-brand-hover">
            Panel admin
          </span>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <LayoutDashboard size={14} />
          Ir a mi dashboard
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
