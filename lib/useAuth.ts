"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Negocio, Usuario } from "@/lib/types";

interface AuthState {
  user: User | null;
  usuario: Usuario | null;
  negocio: Negocio | null;
  loading: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    usuario: null,
    negocio: null,
    loading: true,
  });

  const cargar = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setState({ user: null, usuario: null, negocio: null, loading: false });
      return;
    }

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    let negocio: Negocio | null = null;
    if (usuario?.negocio_id) {
      const { data } = await supabase
        .from("negocios")
        .select("*")
        .eq("id", usuario.negocio_id)
        .maybeSingle();
      negocio = data;
    }

    setState({ user, usuario, negocio, loading: false });
  }, []);

  useEffect(() => {
    cargar();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        cargar();
      }
    });
    return () => subscription.unsubscribe();
  }, [cargar]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [router]);

  return { ...state, logout, refrescar: cargar };
}
