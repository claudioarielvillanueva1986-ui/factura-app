// Scheduled Function de Netlify: dispara el polling de pagos de Mercado Pago
// cada 5 minutos. La lógica pesada (búsqueda + emisión ARCA) vive en la route
// handler de Next (/api/cron/mp-polling), que corre en el runtime donde ARCA
// ya funciona; esta función solo la invoca con el secreto.

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  const secret = process.env.CRON_SECRET || "";
  if (!base || !secret) {
    console.error("mp-polling: falta URL o CRON_SECRET en el entorno");
    return new Response("config faltante", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/mp-polling`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = await res.text();
  console.log(`mp-polling: ${res.status} ${body}`);
  return new Response(body, { status: res.ok ? 200 : 502 });
};

export const config = {
  schedule: "*/5 * * * *",
};
