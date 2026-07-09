import https from "node:https";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import axios from "axios";
import * as soap from "soap";
import { Afip } from "afip.ts";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Los servidores WSAA/WSFE de ARCA todavía negocian TLS con parámetros
// Diffie-Hellman de menos de 2048 bits (legacy). OpenSSL 3 —el que usa el
// runtime de Node en Netlify Functions— rechaza esas conexiones por default
// (nivel de seguridad 2) con "dh key too small".
//
// afip.ts no expone forma de pasarle un httpsAgent propio al cliente SOAP
// que arma internamente, así que envolvemos `soap.createClientAsync` para
// inyectarle por default un axios con un https.Agent dedicado en SECLEVEL 1.
// `request` es una opción soportada y tipada por la librería 'soap'
// ("override the request module"), no un campo interno. Como 'afip.ts' y
// 'soap' están en `serverExternalPackages` (next.config.ts), nuestro
// `import * as soap` compila a un `require("soap")` real: mismo objeto de
// módulo (mismo singleton) que usa afip.ts internamente, así que el parche
// le llega. Con esto NO tocamos el agente HTTPS global del proceso: todo lo
// demás (Supabase, etc.) sigue con el nivel de seguridad TLS por default.
let parcheadoParaArca = false;
function permitirTlsLegacyDeArca() {
  if (parcheadoParaArca) return;
  parcheadoParaArca = true;

  const agenteArca = new https.Agent({ ciphers: "DEFAULT@SECLEVEL=1" });
  const axiosArca = axios.create({ httpsAgent: agenteArca });

  // TS trata el namespace de un `import * as` como de solo lectura; en
  // runtime sigue siendo el mismo objeto (mutable) que usa afip.ts.
  const soapMutable = soap as unknown as { createClientAsync: typeof soap.createClientAsync };
  const original = soapMutable.createClientAsync;
  soapMutable.createClientAsync = (url, options, endpoint) => {
    const opts = { ...(options ?? {}) };
    if (!opts.request) opts.request = axiosArca;
    return original(url, opts, endpoint);
  };
}

// Mapeo de tipo de factura → código de comprobante WSFE (usado también por
// el generador de QR del comprobante, RG 4892)
export const CODIGO_COMPROBANTE: Record<string, number> = { A: 1, B: 6, C: 11 };

// Notas de crédito y débito por letra (WSFE)
const CODIGO_NOTA_CREDITO: Record<string, number> = { A: 3, B: 8, C: 13 };
const CODIGO_NOTA_DEBITO: Record<string, number> = { A: 2, B: 7, C: 12 };

// Código de comprobante según la clase (factura / nota de crédito / débito).
export function codigoComprobante(clase: string | null | undefined, tipo: string): number {
  if (clase === "nota_credito") return CODIGO_NOTA_CREDITO[tipo] ?? CODIGO_NOTA_CREDITO.C;
  if (clase === "nota_debito") return CODIGO_NOTA_DEBITO[tipo] ?? CODIGO_NOTA_DEBITO.C;
  return CODIGO_COMPROBANTE[tipo] ?? CODIGO_COMPROBANTE.C;
}

// 80 = CUIT, 96 = DNI, 99 = consumidor final — usado en la emisión y en el QR
export function docTipoYNro(cuitDni: string | null | undefined) {
  const limpio = (cuitDni ?? "").replace(/[^\d]/g, "");
  const docTipo = limpio.length === 11 ? 80 : limpio.length >= 7 ? 96 : 99;
  const docNro = docTipo === 99 ? 0 : Number(limpio);
  return { docTipo, docNro };
}

// Errores comunes de ARCA en formato amigable
const ERRORES_ARCA: { patron: RegExp; mensaje: string }[] = [
  {
    patron: /certificado|certificate|cms|firma|sign|expirado|expired/i,
    mensaje:
      "Certificado inválido o vencido. Andá a Configuración → ARCA y regenerá el certificado: " +
      "generá un CSR nuevo, subilo a ARCA y volvé a cargar el .crt.",
  },
  {
    patron: /punto de venta|ptovta|pto\.? vta/i,
    mensaje:
      "Punto de venta no habilitado para facturación electrónica. Habilitalo en " +
      "https://serviciosweb.afip.gob.ar → Administración de puntos de venta y domicilios " +
      "(elegí 'RECE para aplicativo y web services').",
  },
  {
    // Delegación faltante. El código 600 de WSFE llega como
    // "ValidacionDeToken: No aparecio CUIT en lista de relaciones: <cuit>":
    // el certificado autentica bien pero ese CUIT no delegó el WS a la
    // plataforma (o la delegación todavía no impactó). Va ANTES del patrón
    // de WSAA porque contiene la palabra "Token" y si no lo atajamos acá se
    // confunde con un error de autenticación.
    patron:
      /lista de relaciones|no aparec\w* .*cuit|no autorizado|not authorized|computador|wsfe.*autoriz|delegaci|representa/i,
    mensaje:
      "Tu CUIT todavía no está autorizado para usar el web service de facturación (WSFE). " +
      "Entrá a ARCA → Administrador de Relaciones de Clave Fiscal → Nueva Relación → " +
      "ARCA → WebServices → Facturación Electrónica, y autorizá el CUIT de facturá. " +
      "La delegación puede tardar hasta 24 hs en impactar.",
  },
  {
    // WSAA propiamente dicho (login/ticket de acceso). Evitamos el genérico
    // "token" para no capturar el "ValidacionDeToken" de la delegación.
    patron: /\bwsaa\b|ta\.xml|logincms|generando ticket|ticket de acceso|autenticaci/i,
    mensaje:
      "Error de autenticación con ARCA (WSAA). Suele resolverse reintentando en unos minutos. " +
      "Si persiste, revisá que el certificado esté asociado al servicio 'wsfe'.",
  },
  {
    patron: /dh key too small|tls_process_ske|EPROTO|SSL routines/i,
    mensaje:
      "Error de conexión segura con los servidores de ARCA (cifrado TLS incompatible). " +
      "No es un problema de tu cuenta ni de la delegación — es un ajuste técnico de " +
      "nuestro lado. Reintentá en un momento; si persiste, contactá a soporte.",
  },
];

export function mensajeErrorARCA(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  const conocido = ERRORES_ARCA.find((e) => e.patron.test(texto));
  if (conocido) return conocido.mensaje;
  return `Error de ARCA: ${texto}`;
}

function fechaWSFE(fecha: string) {
  // "2026-07-03" → "20260703"
  return fecha.replaceAll("-", "");
}

function parseFechaCAE(caeFchVto: string): string | null {
  // "20260713" → "2026-07-13"
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(caeFchVto ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface ResultadoEmision {
  ok: boolean;
  cae?: string;
  cae_vencimiento?: string | null;
  numero?: number;
  error?: string;
  // La conexión con ARCA todavía está propagando (ventana de 24 hs): la
  // factura quedó guardada como pendiente y se emite sola cuando se habilite.
  pendiente?: boolean;
}

interface NegocioARCA {
  id: string;
  cuit: string | null;
  punto_venta: number | null;
  condicion_iva: string;
  arca_modo?: string | null;
  arca_verificado_en?: string | null;
  arca_delegado_en?: string | null;
}

// ARCA puede tardar hasta 24 hs, desde que se hace la delegación, en habilitar
// la EMISIÓN de comprobantes (la lectura funciona antes). Para no generar
// errores durante esa ventana, no intentamos emitir hasta que pase: la factura
// queda pendiente y se emite sola después (vía el cron de reintento).
const VENTANA_PROPAGACION_ARCA_MS = 24 * 60 * 60 * 1000;

// Arranque de la ventana: el momento real de la delegación si el admin lo
// cargó (arca_delegado_en); si no, cuándo se verificó en la app.
function inicioVentanaArca(negocio: NegocioARCA): string | null {
  return negocio.arca_delegado_en ?? negocio.arca_verificado_en ?? null;
}

function arcaEnPropagacion(inicio: string | null): boolean {
  if (!inicio) return false; // sin referencia no gateamos: fallará con otro mensaje claro
  return Date.now() - new Date(inicio).getTime() < VENTANA_PROPAGACION_ARCA_MS;
}

// Resuelve las credenciales según el modo del negocio:
// - 'delegado' (default): certificado ÚNICO de la plataforma (env vars) +
//   CUIT del cliente en los requests. El cliente solo delega el WS en ARCA.
// - 'certificado_propio': CSR/cert por negocio en arca_credenciales.
async function credencialesParaNegocio(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  negocio: NegocioARCA
): Promise<{ keyPem?: string; certPem?: string; error?: string }> {
  if (negocio.arca_modo === "certificado_propio") {
    const { data: cred } = await admin
      .from("arca_credenciales")
      .select("key_pem, cert_pem")
      .eq("negocio_id", negocio.id)
      .maybeSingle();

    if (!cred?.key_pem || !cred?.cert_pem) {
      return {
        error:
          "Faltan las credenciales de ARCA. Completá el asistente de certificado propio en Configuración → ARCA.",
      };
    }
    return { keyPem: cred.key_pem, certPem: cred.cert_pem };
  }

  // Modo delegado: certificado de la plataforma desde el entorno.
  // En Netlify los PEM multilinea suelen cargarse con \n escapados.
  const keyPem = process.env.PLATAFORMA_AFIP_KEY?.replace(/\\n/g, "\n");
  const certPem = process.env.PLATAFORMA_AFIP_CERT?.replace(/\\n/g, "\n");
  if (!keyPem || !certPem) {
    return {
      error:
        "La plataforma no tiene configurado su certificado de ARCA " +
        "(PLATAFORMA_AFIP_KEY / PLATAFORMA_AFIP_CERT). Contactá a soporte.",
    };
  }
  return { keyPem, certPem };
}

// ---------- Cache compartido del TA de WSAA (ver migración 017) ----------
// afip.ts guarda el TA en /tmp/TA-{cuit}-wsfe[-production].json. En serverless
// ese archivo no persiste entre invocaciones, así que cada emisión pide un TA
// nuevo y ARCA rechaza con "ya posee un TA valido". Guardamos un único TA en
// la base (es del certificado, sirve para cualquier CUIT) y lo escribimos en
// /tmp antes de emitir para que afip.ts lo reuse.
function cuitNumerico(cuit: string) {
  return String(Number(String(cuit).replace(/[^\d]/g, "")));
}
function rutaTA(cuit: string) {
  const prod = process.env.AFIP_MODE === "production";
  return join("/tmp", `TA-${cuitNumerico(cuit)}-wsfe${prod ? "-production" : ""}.json`);
}

// Escribe en /tmp el TA cacheado en la base (si sigue vigente) para que
// afip.ts lo reuse en vez de pedir uno nuevo a WSAA.
async function precargarTA(admin: AdminClient, cuit: string) {
  const prod = process.env.AFIP_MODE === "production";
  const { data } = await admin
    .from("arca_ta_cache")
    .select("ta_json, expira_en")
    .eq("produccion", prod)
    .maybeSingle();
  if (!data?.ta_json || !data.expira_en) return;
  // Solo si le quedan más de 10 min de vida (margen de seguridad).
  if (new Date(data.expira_en).getTime() - Date.now() < 10 * 60 * 1000) return;
  try {
    await fs.writeFile(rutaTA(cuit), JSON.stringify(data.ta_json), "utf8");
  } catch {
    /* best-effort: si no se puede escribir, afip.ts pedirá uno nuevo */
  }
}

// Después de emitir, si afip.ts obtuvo un TA nuevo, lo guarda en la base para
// compartirlo con las próximas emisiones (de cualquier negocio/instancia).
async function persistirTA(admin: AdminClient, cuit: string) {
  const prod = process.env.AFIP_MODE === "production";
  let raw: string;
  try {
    raw = await fs.readFile(rutaTA(cuit), "utf8");
  } catch {
    return;
  }
  let ta: { header?: Array<{ expirationtime?: string }> };
  try {
    ta = JSON.parse(raw);
  } catch {
    return;
  }
  const expStr = ta?.header?.[1]?.expirationtime;
  const expira = expStr ? new Date(expStr) : null;
  if (!expira || Number.isNaN(expira.getTime())) return;
  await admin.from("arca_ta_cache").upsert(
    {
      produccion: prod,
      ta_json: ta,
      expira_en: expira.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "produccion" }
  );
}

// Diagnóstico: guarda el error CRUDO de ARCA (no el amigable) para poder
// verlo por SQL. Best-effort, nunca rompe la emisión.
async function logArcaRaw(admin: AdminClient, facturaId: string, raw: string) {
  try {
    await admin.from("mp_polling_logs").insert({
      resultado: `arca_raw factura=${facturaId}`,
      error: raw.slice(0, 1500),
    });
  } catch {
    /* best-effort */
  }
}

function clienteAfip(keyPem: string, certPem: string, cuit: string) {
  permitirTlsLegacyDeArca();
  return new Afip({
    key: keyPem,
    cert: certPem,
    cuit: Number(String(cuit).replace(/[^\d]/g, "")),
    production: process.env.AFIP_MODE === "production",
    // Serverless: el único filesystem escribible en Netlify Functions es /tmp
    ticketPath: "/tmp",
  });
}

export interface ResultadoPrueba {
  ok: boolean;
  detalle?: string;
  error?: string;
}

// Prueba la conexión con ARCA para un negocio: autentica en WSAA y consulta
// el último comprobante del punto de venta. Si funciona, la delegación (o el
// certificado propio) está operativa; marca arca_verificado_en.
export async function probarConexionARCA(negocioId: string): Promise<ResultadoPrueba> {
  const admin = createSupabaseAdminClient();

  const { data: negocio } = await admin
    .from("negocios")
    .select("id, cuit, punto_venta, condicion_iva, arca_modo")
    .eq("id", negocioId)
    .maybeSingle();

  if (!negocio) return { ok: false, error: "Negocio no encontrado" };

  const cuit = (negocio.cuit ?? "").replace(/[^\d]/g, "");
  if (cuit.length !== 11) {
    return {
      ok: false,
      error: "Cargá el CUIT del negocio (11 dígitos) en Configuración → Negocio antes de probar.",
    };
  }

  const cred = await credencialesParaNegocio(admin, negocio);
  if (cred.error || !cred.keyPem || !cred.certPem) {
    return { ok: false, error: cred.error ?? "Credenciales incompletas" };
  }

  try {
    const afip = clienteAfip(cred.keyPem, cred.certPem, cuit);
    await precargarTA(admin, cuit);
    const puntoVenta = negocio.punto_venta ?? 1;
    const tipoPrueba =
      negocio.condicion_iva === "monotributo"
        ? CODIGO_COMPROBANTE.C
        : CODIGO_COMPROBANTE.B;

    // getLastVoucher pasa por WSAA + WSFE: valida certificado, delegación
    // y punto de venta en una sola llamada
    const ultimo = await afip.electronicBillingService.getLastVoucher(
      puntoVenta,
      tipoPrueba
    );
    await persistirTA(admin, cuit);

    await admin
      .from("negocios")
      .update({ arca_verificado_en: new Date().toISOString() })
      .eq("id", negocioId);

    return {
      ok: true,
      detalle: `Conexión OK. Último comprobante del punto de venta ${puntoVenta}: N° ${ultimo.CbteNro}.`,
    };
  } catch (error) {
    return { ok: false, error: mensajeErrorARCA(error) };
  }
}

// Emite una factura existente (en borrador) contra WSFE de ARCA/AFIP.
// Corre solo en servidor: lee credenciales con service_role y actualiza estado.
export async function emitirFacturaARCA(facturaId: string): Promise<ResultadoEmision> {
  const admin = createSupabaseAdminClient();

  const { data: factura, error: errFactura } = await admin
    .from("facturas")
    .select(
      "*, clientes(nombre, cuit_dni), negocios(id, cuit, punto_venta, condicion_iva, arca_modo, arca_verificado_en, arca_delegado_en)"
    )
    .eq("id", facturaId)
    .single();

  if (errFactura || !factura) {
    return { ok: false, error: "Factura no encontrada" };
  }
  if (factura.estado === "emitida" || factura.estado === "enviada") {
    return {
      ok: true,
      cae: factura.cae,
      cae_vencimiento: factura.cae_vencimiento,
      numero: factura.numero,
    };
  }

  // Claim atómico contra doble emisión: entre chequear el estado y guardar el
  // CAE pasan varios segundos (WSAA + WSFE). Dos requests concurrentes (doble
  // click, retry por timeout) autorizarían DOS comprobantes distintos en AFIP.
  // El UPDATE condicional solo lo gana uno: Postgres serializa las filas y el
  // segundo ve el lock ya tomado. El lock se libera solo si quedó viejo (>2
  // min: emisión colgada) para permitir reintentos legítimos.
  const lockPrevio = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claim } = await admin
    .from("facturas")
    .update({ emision_lock_at: new Date().toISOString() })
    .eq("id", facturaId)
    .in("estado", ["borrador", "error"])
    .or(`emision_lock_at.is.null,emision_lock_at.lt.${lockPrevio}`)
    .select("id");

  if (!claim || claim.length === 0) {
    return { ok: false, error: "La factura ya se está emitiendo. Esperá unos segundos y verificá el estado." };
  }

  const negocio = factura.negocios;
  if (!negocio?.cuit) {
    return await marcarError(admin, facturaId, "Configurá el CUIT del negocio en Configuración antes de emitir.");
  }

  const cred = await credencialesParaNegocio(admin, negocio);
  if (cred.error || !cred.keyPem || !cred.certPem) {
    return await marcarError(admin, facturaId, cred.error ?? "Credenciales incompletas");
  }

  // Portón anti-errores: si la delegación de ARCA todavía está propagando
  // (ventana de 24 hs desde la verificación), NO intentamos emitir. Dejamos la
  // factura pendiente (borrador con aviso, no error) y el cron la emite sola
  // cuando pase la ventana.
  const inicioVentana = inicioVentanaArca(negocio);
  if (arcaEnPropagacion(inicioVentana)) {
    return await marcarPendienteArca(admin, facturaId, inicioVentana!);
  }

  try {
    const afip = clienteAfip(cred.keyPem, cred.certPem, negocio.cuit);
    // Reusar el TA cacheado (evita "ya posee un TA valido" en serverless).
    await precargarTA(admin, negocio.cuit);

    const cbteTipo = codigoComprobante(factura.clase, factura.tipo);
    const { docTipo, docNro } = docTipoYNro(factura.clientes?.cuit_dni);

    const esA = factura.tipo === "A";
    const impNeto = esA ? Number(factura.subtotal) : Number(factura.total);
    const impIVA = esA ? Number(factura.iva) : 0;

    // Número real según AFIP (puede diferir del provisorio local si se
    // emitieron comprobantes por fuera de la app)
    const puntoVenta = negocio.punto_venta ?? 1;
    const ultimo = await afip.electronicBillingService.getLastVoucher(puntoVenta, cbteTipo);
    // Recién ahora afip.ts hizo el login WSAA: guardamos el TA para compartirlo.
    await persistirTA(admin, negocio.cuit);
    const numeroAfip = Number(ultimo.CbteNro) + 1;

    // Nota de crédito/débito: debe referenciar el comprobante que ajusta.
    let cbtesAsoc: { Tipo: number; PtoVta: number; Nro: number }[] | undefined;
    if (factura.clase !== "factura" && factura.comprobante_asociado_id) {
      const { data: asoc } = await admin
        .from("facturas")
        .select("tipo, numero")
        .eq("id", factura.comprobante_asociado_id)
        .maybeSingle();
      if (asoc) {
        cbtesAsoc = [
          { Tipo: CODIGO_COMPROBANTE[asoc.tipo] ?? cbteTipo, PtoVta: puntoVenta, Nro: asoc.numero },
        ];
      }
    }

    // CbtesAsoc no está tipado en IVoucher de afip.ts pero WSFE lo soporta;
    // se arma el objeto aparte para no chocar con el chequeo de propiedades.
    const voucher = {
      CantReg: 1,
      PtoVta: puntoVenta,
      CbteTipo: cbteTipo,
      CbteDesde: numeroAfip,
      CbteHasta: numeroAfip,
      Concepto: 1, // Productos
      DocTipo: docTipo,
      DocNro: docNro,
      CbteFch: fechaWSFE(factura.fecha),
      ImpTotal: Number(factura.total),
      ImpTotConc: 0,
      ImpNeto: impNeto,
      ImpOpEx: 0,
      ImpIVA: impIVA,
      ImpTrib: 0,
      MonId: "PES",
      MonCotiz: 1,
      ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
      ...(esA
        ? {
            Iva: [
              { Id: 5, BaseImp: Number(factura.subtotal), Importe: Number(factura.iva) }, // 5 = 21%
            ],
          }
        : {}),
    };
    const resultado = await afip.electronicBillingService.createVoucher(
      voucher as Parameters<typeof afip.electronicBillingService.createVoucher>[0]
    );

    if (!resultado.cae) {
      const detalle = JSON.stringify(resultado.response ?? {});
      await logArcaRaw(admin, facturaId, `WSFE sin CAE: ${detalle}`);
      return await marcarError(admin, facturaId, mensajeErrorARCA(detalle));
    }

    const caeVencimiento = parseFechaCAE(resultado.caeFchVto);

    await admin
      .from("facturas")
      .update({
        cae: resultado.cae,
        cae_vencimiento: caeVencimiento,
        estado: "emitida",
        error_mensaje: null,
        numero: numeroAfip,
        emision_lock_at: null,
      })
      .eq("id", facturaId);

    // Envío automático del comprobante por email (best-effort: nunca rompe la
    // emisión ni la bloquea si el proveedor de email no está configurado).
    try {
      const { enviarComprobantePorEmail } = await import("@/lib/email");
      await enviarComprobantePorEmail(facturaId);
    } catch {
      /* el email es secundario: la factura ya quedó emitida con CAE */
    }

    return {
      ok: true,
      cae: resultado.cae,
      cae_vencimiento: caeVencimiento,
      numero: numeroAfip,
    };
  } catch (error) {
    const raw = error instanceof Error ? `${error.message}` : String(error);
    await logArcaRaw(admin, facturaId, `catch: ${raw}`);
    return await marcarError(admin, facturaId, mensajeErrorARCA(error));
  }
}

async function marcarError(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  facturaId: string,
  mensaje: string
): Promise<ResultadoEmision> {
  // Libera el lock de emisión para permitir un reintento inmediato.
  await admin
    .from("facturas")
    .update({ estado: "error", error_mensaje: mensaje, emision_lock_at: null })
    .eq("id", facturaId);
  return { ok: false, error: mensaje };
}

// La factura no se pudo intentar todavía porque ARCA está propagando la
// delegación. Queda en 'borrador' (no cuenta como error) con un aviso, y se
// reintenta sola cuando pase la ventana de 24 hs.
async function marcarPendienteArca(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  facturaId: string,
  verificadoEn: string
): Promise<ResultadoEmision> {
  const listo = new Date(new Date(verificadoEn).getTime() + VENTANA_PROPAGACION_ARCA_MS);
  const cuando = listo.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const mensaje =
    `Estamos activando tu conexión con ARCA (puede tardar hasta 24 hs desde que verificaste). ` +
    `La factura queda guardada y se emite sola a partir del ${cuando} hs, sin que hagas nada.`;
  await admin
    .from("facturas")
    .update({ estado: "borrador", error_mensaje: mensaje, emision_lock_at: null })
    .eq("id", facturaId);
  return { ok: false, pendiente: true, error: mensaje };
}
