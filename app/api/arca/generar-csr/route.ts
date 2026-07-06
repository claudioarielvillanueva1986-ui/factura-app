import { NextResponse } from "next/server";
import forge from "node-forge";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { exigirAdmin } from "@/lib/authz";

export const runtime = "nodejs";

// Genera una clave RSA 2048 + CSR para tramitar el certificado en ARCA.
// La clave privada queda guardada en arca_credenciales (solo service_role);
// el CSR se devuelve como archivo descargable. Solo el admin del negocio
// puede regenerarla (invalida el certificado vigente).
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const authz = await exigirAdmin(supabase, user.id);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { data: negocioData } = await supabase
    .from("negocios")
    .select("nombre, cuit, razon_social")
    .eq("id", authz.usuario.negocio_id)
    .maybeSingle();

  const negocio = negocioData as {
    nombre: string;
    cuit: string | null;
    razon_social: string | null;
  } | null;

  const cuit = (negocio?.cuit ?? "").replace(/[^\d]/g, "");
  if (cuit.length !== 11) {
    return NextResponse.json(
      { error: "Cargá el CUIT del negocio (11 dígitos) en Configuración antes de generar el CSR." },
      { status: 400 }
    );
  }

  // Clave RSA 2048 + CSR (formato requerido por WSAA de ARCA)
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: negocio?.razon_social || negocio?.nombre || "facturá" },
    { name: "commonName", value: "facturacion" },
    { name: "serialNumber", value: `CUIT ${cuit}` },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const csrPem = forge.pki.certificationRequestToPem(csr);

  // La clave privada nunca viaja al browser: se guarda con service_role
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("arca_credenciales").upsert({
    negocio_id: authz.usuario.negocio_id,
    key_pem: keyPem,
    cert_pem: null, // el certificado anterior deja de corresponder a esta clave
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: "No se pudo guardar la clave privada" }, { status: 500 });
  }

  return new NextResponse(csrPem, {
    status: 200,
    headers: {
      "Content-Type": "application/x-pem-file",
      "Content-Disposition": 'attachment; filename="facturacion.csr"',
    },
  });
}
