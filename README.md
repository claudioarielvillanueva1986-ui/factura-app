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
| `007_datos_fiscales.sql` | Domicilio, Ingresos Brutos e inicio de actividades del negocio (encabezado del PDF) |
| `008_seguridad.sql` | Hardening: oculta tokens de MP, evita autoescalación de rol, congela facturas emitidas, cierra RPCs a `anon` |
| `009_suscripciones.sql` | `plataforma_admins`, `configuracion_plataforma`, estado de cuenta/trial/gracia en `negocios`, `pagos_suscripcion`, RPCs de administración |

### Variables de entorno (`.env.local`)

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (solo servidor: ARCA, webhook MP) |
| `AFIP_MODE` | `production` u `homologacion` (WSDL de testing) |
| `NEXT_PUBLIC_PLATAFORMA_CUIT` | CUIT de la plataforma que los clientes autorizan en ARCA |
| `NEXT_PUBLIC_PLATAFORMA_ALIAS` | Alias del certificado de la plataforma (ej: `factura-prod`) |
| `PLATAFORMA_AFIP_KEY` / `PLATAFORMA_AFIP_CERT` | Clave + certificado ÚNICOS de la plataforma (modo delegado) |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Credenciales de la aplicación de Mercado Pago (OAuth, para que los negocios cobren a SUS clientes) |
| `MP_WEBHOOK_SECRET` | Firma secreta para validar `x-signature` en los webhooks de MP (opcional pero recomendado) |
| `PLATAFORMA_MP_ACCESS_TOKEN` | Access token de la cuenta PROPIA de MP de la plataforma, para cobrar la suscripción a cada negocio |
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

## Comprobante en PDF

Cada factura emitida (con CAE) tiene un PDF en formato oficial argentino,
disponible en `GET /api/facturas/{id}/pdf` (botón "Descargar PDF" en el
listado de facturas, envíos y en la pantalla de éxito al emitir):

- Encabezado con razón social, domicilio comercial, condición frente al IVA,
  CUIT, Ingresos Brutos e inicio de actividades del emisor
- Datos del receptor y detalle de ítems
- Impuestos según el tipo de comprobante:
  - **A**: IVA discriminado (Neto Gravado + IVA 21% + Total)
  - **B**: Total con la leyenda de IVA contenido (Régimen de Transparencia
    Fiscal al Consumidor, Ley 27.743)
  - **C**: sin IVA (monotributo)
- CAE, vencimiento y el **código QR obligatorio** (RG 4892/2020 de AFIP)

Requiere que el negocio complete Domicilio, Ingresos Brutos e Inicio de
actividades en Configuración → Negocio (son datos obligatorios del
encabezado).

## Suscripciones y panel de administración

`/admin` es el panel para gestionar TODOS los negocios de la plataforma
(distinto del `Configuración` de cada negocio): estado de cuenta, extender
trial, dar período de gracia, cambiar precio, notas internas, cancelar
suscripción y ver historial de pagos. Solo lo ve quien esté en la tabla
`plataforma_admins` — para dar de alta al primer admin (una sola vez, a
mano, después de que esa persona se haya registrado normalmente en la app):

```sql
insert into plataforma_admins (usuario_id)
values ('<uuid del usuario en auth.users>');
```

**Cobro de la suscripción**: cada negocio, desde Configuración → Suscripción,
activa el cobro automático mensual (botón que crea un *Preapproval* de
Mercado Pago y redirige a autorizarlo). Usa la cuenta **propia** de MP de la
plataforma (`PLATAFORMA_MP_ACCESS_TOKEN`), separada de la que cada negocio
conecta por OAuth para cobrar a sus propios clientes. Webhook a configurar
en esa cuenta: `{NEXT_PUBLIC_APP_URL}/api/billing/webhook` (evento
"Suscripciones"). Mientras el trial y el eventual período de gracia estén
vigentes (o la suscripción esté activa), el negocio puede emitir facturas;
fuera de eso, `crear_factura`/`crear_factura_mp` lo bloquean del lado del
servidor (`cuenta_habilitada_para_facturar`), no solo en la UI.

## Seguridad

- RLS en todas las tablas: cada negocio ve solo sus filas (`mi_negocio_id()`).
- `arca_credenciales`, `mp_webhook_logs` y `plataforma_admins` **no tienen
  políticas de cliente**: solo la `service_role` (o las RPCs `SECURITY
  DEFINER` que las consultan) puede leerlas.
- La clave privada de ARCA se genera y guarda en el servidor; nunca pasa por el
  navegador (solo se descarga el CSR).
- Los tokens de Mercado Pago (`access_token`/`refresh_token`) no son legibles
  desde el cliente; la UI solo ve columnas derivadas (`conectado`, `manual`).
- Solo el `rol = 'admin'` de un negocio puede tocar configuración sensible
  (CUIT, ARCA, conectar/desconectar MP) — reforzado por columnas de RLS, no
  solo por la UI. Las facturas con CAE quedan congeladas por trigger: no se
  pueden editar montos ni borrarlas desde el cliente.
