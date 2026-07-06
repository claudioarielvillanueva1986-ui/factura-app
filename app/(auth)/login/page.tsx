"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Modo = "login" | "registro";

const PENDING_KEY = "factura_pending_onboarding";

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("login");
  const [nombre, setNombre] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Si el signUp requirió confirmación por email, el negocio se crea recién
  // en el primer login con los datos guardados en localStorage.
  async function asegurarNegocio() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: fila } = await supabase
      .from("usuarios")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (fila) return;

    let pendiente = { nombre: "Mi cuenta", nombre_negocio: "Mi negocio" };
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) pendiente = { ...pendiente, ...JSON.parse(raw) };
    } catch {
      /* sin datos pendientes */
    }

    await supabase.rpc("crear_negocio_inicial", {
      nombre_negocio: pendiente.nombre_negocio,
      nombre_usuario: pendiente.nombre,
    });
    localStorage.removeItem(PENDING_KEY);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setCargando(true);

    try {
      if (modo === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(traducirError(error.message));
        await asegurarNegocio();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(traducirError(error.message));

        if (data.session) {
          // Sin confirmación de email: crear negocio + usuario ya mismo
          const { error: errRpc } = await supabase.rpc("crear_negocio_inicial", {
            nombre_negocio: nombreNegocio,
            nombre_usuario: nombre,
          });
          if (errRpc) throw new Error(errRpc.message);
        } else {
          // Confirmación pendiente: guardar datos para el primer login
          localStorage.setItem(
            PENDING_KEY,
            JSON.stringify({ nombre, nombre_negocio: nombreNegocio })
          );
          setAviso("Te enviamos un email para confirmar la cuenta. Confirmalo y volvé a ingresar.");
          setCargando(false);
          return;
        }
      }

      // Soporte para retorno tras login (ej: flujo OAuth de partner).
      // Solo rutas internas para evitar open-redirect ("//evil.com" también
      // empieza con "/" pero el navegador lo trata como protocol-relative).
      const next = new URLSearchParams(window.location.search).get("next");
      const destino = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.push(destino);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal, probá de nuevo");
      setCargando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <Logo size="text-3xl" />
          <p className="mt-2 text-[13px] text-text-secondary">
            Facturación electrónica simple para tu negocio
          </p>
        </div>

        <div className="rounded-card border border-line bg-surface p-6">
          {/* Tabs login / registro */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-btn bg-[#1A2235] p-1">
            {(["login", "registro"] as Modo[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModo(m);
                  setError(null);
                  setAviso(null);
                }}
                className={`rounded-[6px] py-1.5 text-[13px] font-medium transition-colors ${
                  modo === m
                    ? "bg-brand text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {m === "login" ? "Ingresar" : "Crear cuenta"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5">
            {modo === "registro" && (
              <>
                <Input
                  id="nombre"
                  label="Tu nombre"
                  placeholder="Juan Pérez"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                />
                <Input
                  id="nombre-negocio"
                  label="Nombre del negocio"
                  placeholder="Kiosco El Sol"
                  value={nombreNegocio}
                  onChange={(e) => setNombreNegocio(e.target.value)}
                  required
                />
              </>
            )}

            <Input
              id="email"
              label="Email"
              type="email"
              placeholder="vos@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              id="password"
              label="Contraseña"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />

            {error && (
              <p className="rounded-btn bg-status-error/15 px-3 py-2 text-[12px] text-status-error">
                {error}
              </p>
            )}
            {aviso && (
              <p className="rounded-btn bg-accent-dim px-3 py-2 text-[12px] text-accent-light">
                {aviso}
              </p>
            )}

            <Button type="submit" disabled={cargando} className="w-full py-2.5">
              {cargando
                ? "Un momento…"
                : modo === "login"
                  ? "Ingresar"
                  : "Crear mi cuenta"}
            </Button>
          </form>
        </div>

        <div className="mt-4 rounded-card border border-accent/20 bg-accent-dim px-4 py-3 text-center text-[12px] text-accent-light">
          ¿Primera vez? Probá <strong>7 días gratis</strong> sin tarjeta
        </div>
      </div>
    </main>
  );
}

function traducirError(mensaje: string) {
  if (/invalid login credentials/i.test(mensaje)) return "Email o contraseña incorrectos";
  if (/already registered/i.test(mensaje)) return "Ese email ya tiene una cuenta. Probá ingresar.";
  if (/rate limit/i.test(mensaje)) return "Demasiados intentos, esperá un minuto";
  if (/password should be/i.test(mensaje)) return "La contraseña necesita al menos 6 caracteres";
  return mensaje;
}
