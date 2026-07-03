import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { probarConexionARCA } from "@/lib/arca";

export const runtime = "nodejs";
export const maxDuration = 26;

// Prueba la conexión ARCA del negocio del usuario (delegación o certificado
// propio): WSAA + consulta de último comprobante.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("negocio_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!usuario?.negocio_id) {
    return NextResponse.json({ error: "Usuario sin negocio" }, { status: 400 });
  }

  const resultado = await probarConexionARCA(usuario.negocio_id);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 422 });
  }
  return NextResponse.json(resultado);
}
