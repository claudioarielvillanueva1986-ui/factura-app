import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Guarda el certificado .crt emitido por ARCA en arca_credenciales.
export async function POST(request: NextRequest) {
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

  const { cert_pem } = (await request.json()) as { cert_pem?: string };
  if (!cert_pem || !cert_pem.includes("-----BEGIN CERTIFICATE-----")) {
    return NextResponse.json(
      { error: "El archivo no parece un certificado PEM válido (.crt)" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: cred } = await admin
    .from("arca_credenciales")
    .select("key_pem")
    .eq("negocio_id", usuario.negocio_id)
    .maybeSingle();

  if (!cred?.key_pem) {
    return NextResponse.json(
      { error: "Primero generá el CSR (paso 1) para tener la clave privada" },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("arca_credenciales")
    .update({ cert_pem, updated_at: new Date().toISOString() })
    .eq("negocio_id", usuario.negocio_id);

  if (error) {
    return NextResponse.json({ error: "No se pudo guardar el certificado" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Estado de las credenciales (sin exponer los PEM al cliente)
export async function GET() {
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
    return NextResponse.json({ tiene_clave: false, tiene_cert: false });
  }

  const admin = createSupabaseAdminClient();
  const { data: cred } = await admin
    .from("arca_credenciales")
    .select("key_pem, cert_pem")
    .eq("negocio_id", usuario.negocio_id)
    .maybeSingle();

  return NextResponse.json({
    tiene_clave: Boolean(cred?.key_pem),
    tiene_cert: Boolean(cred?.cert_pem),
  });
}
