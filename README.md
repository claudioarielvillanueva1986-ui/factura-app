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

### Variables de entorno (`.env.local`)

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (solo servidor: ARCA, webhook MP) |
| `AFIP_MODE` | `production` u `homologacion` (WSDL de testing) |
| `NEXT_PUBLIC_APP_URL` | URL pública del deploy (webhook de MP) |

En Netlify configurar las mismas variables en **Site settings → Environment variables**.

## Seguridad

- RLS en todas las tablas: cada negocio ve solo sus filas (`mi_negocio_id()`).
- `arca_credenciales` y `mp_webhook_logs` **no tienen políticas de cliente**:
  solo la `service_role` (Netlify Functions) puede leerlas.
- La clave privada de ARCA se genera y guarda en el servidor; nunca pasa por el
  navegador (solo se descarga el CSR).
