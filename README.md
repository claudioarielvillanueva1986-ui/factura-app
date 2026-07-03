# facturá.

SaaS de facturación electrónica argentina, mobile-first, para monotributistas y
responsables inscriptos. Emisión en ARCA/AFIP (WSFE), auto-facturación de pagos
de Mercado Pago y envío de comprobantes por WhatsApp.

## Stack

- **Next.js 15** + TypeScript (App Router)
- **Tailwind CSS** — paleta dark fintech (`bg #0B0F1A`, `surface #141927`, `brand #7C3AED`, `accent #14B8A6`)
- **Supabase** — Auth + Postgres + RLS + RPCs
- **Netlify** — deploy con route handlers como serverless functions (ARCA y Mercado Pago)
- **afip.ts** — SDK para WSAA + WSFE de ARCA/AFIP

## Setup

```bash
npm install
cp .env.example .env.local   # completar credenciales
npm run dev
```

### Base de datos

Aplicar las migraciones de `supabase/migrations/` en orden (via SQL Editor de
Supabase o `supabase db push`):

| Archivo | Contenido |
| --- | --- |
| `001_schema.sql` | Tablas + enums + RLS por `negocio_id` |
| `002_rpcs_auth.sql` | `crear_negocio_inicial` (onboarding con trial de 7 días) |
| `003_dashboard.sql` | `resumen_dashboard` (stats + gráfico semanal) |
| `004_facturas.sql` | `crear_factura` (numeración por tipo + IVA) |
| `005_mercadopago.sql` | `crear_factura_mp` + `mp_webhook_logs` |
| `006_produccion.sql` | OAuth de MP (tokens con refresh) + modo ARCA delegado |

### Variables de entorno (`.env.local`)

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (solo servidor: ARCA, webhook MP) |
| `AFIP_MODE` | `production` u `homologacion` (WSDL de testing) |
| `NEXT_PUBLIC_PLATAFORMA_CUIT` | CUIT de la plataforma que los clientes autorizan en ARCA |
| `PLATAFORMA_AFIP_KEY` / `PLATAFORMA_AFIP_CERT` | Clave + certificado ÚNICOS de la plataforma (modo delegado) |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Credenciales de la aplicación de Mercado Pago (OAuth) |
| `NEXT_PUBLIC_APP_URL` | URL pública del deploy (OAuth y webhooks) |

En Netlify configurar las mismas variables en **Site settings → Environment variables**.

## Onboarding de clientes en producción

**Mercado Pago (OAuth)** — el cliente toca "Conectar con Mercado Pago", autoriza y
listo. Requiere una única configuración de plataforma en el
[panel de aplicaciones de MP](https://www.mercadopago.com.ar/developers/panel/app):

- Redirect URL: `{NEXT_PUBLIC_APP_URL}/api/mp/oauth/callback`
- Webhook (evento **Pagos**): `{NEXT_PUBLIC_APP_URL}/api/mp/webhook` — un solo
  webhook para todas las cuentas conectadas (se resuelve el negocio por `user_id`).
- Los tokens duran ~6 meses y se refrescan solos antes de vencer.

**ARCA (delegación de web service)** — la plataforma tiene UN certificado
(tramitado con el CUIT de facturá.); cada cliente solo autoriza ese CUIT en
**Administrador de Relaciones de Clave Fiscal → Nueva Relación → ARCA →
WebServices → Facturación Electrónica** y crea su punto de venta para web
services. Sin CSR ni archivos. El botón "Probar conexión" valida la delegación
(WSAA + último comprobante). El flujo de certificado propio por negocio queda
disponible como opción avanzada (`negocios.arca_modo = 'certificado_propio'`).

## Seguridad

- RLS en todas las tablas: cada negocio ve solo sus filas (`mi_negocio_id()`).
- `arca_credenciales` y `mp_webhook_logs` **no tienen políticas de cliente**:
  solo la `service_role` (Netlify Functions) puede leerlas.
- La clave privada de ARCA se genera y guarda en el servidor; nunca pasa por el
  navegador (solo se descarga el CSR).
