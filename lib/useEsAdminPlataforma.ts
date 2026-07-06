"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Chequea si el usuario logueado es admin de LA PLATAFORMA (no de un
// negocio particular) — para mostrar/ocultar el link al panel /admin.
export function useEsAdminPlataforma() {
  const [esAdmin, setEsAdmin] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase.rpc("es_admin_plataforma").then(({ data }) => {
      if (vivo) setEsAdmin(Boolean(data));
    });
    return () => {
      vivo = false;
    };
  }, []);

  return esAdmin;
}
