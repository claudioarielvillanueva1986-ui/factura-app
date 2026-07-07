# Partner API — facturá. como hub del ecosistema

Permite que aplicaciones externas propias (ej: **Soporte Móvil**) emitan
facturas en ARCA y creen cobros de Mercado Pago **en nombre de un negocio de
facturá.**, sin manejar certificados ni tokens sensibles. Es una integración
_soft-a-soft_: el taller configura ARCA y Mercado Pago **una sola vez en
facturá.** y el resto del ecosistema se enchufa.

Todo lo sensible (certificado ARCA de la plataforma, tokens OAuth de MP) vive
siempre en facturá. La app externa solo recibe un `access_token` acotado por
_scopes_.

## Alta de una app partner (una vez por producto)

1. Generá un `client_id` legible (ej: `soporte-movil`) y un `client_secret`
   aleatorio. Guardá el **hash** del secreto:

   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('EL_SECRETO').digest('hex'))"
   ```

2. Insertá la fila en `partner_apps` (ver ejemplo comentado al final de
   `supabase/migrations/010_partners.sql`), con las `redirect_uris` y el
   `webhook_url` reales de la app externa y un `webhook_secret` para firmar
   las notificaciones salientes.

3. Entregá `client_id` + `client_secret` (en claro, una vez) a la app externa.

## Flujo OAuth (authorization-code, PKCE opcional)

Igual que "Iniciar sesión con Google", pero la marca es facturá.

1. La app externa manda el navegador a:

   ```
   {FACTURA_URL}/oauth/autorizar?client_id=...&redirect_uri=...&response_type=code
       &scope=facturacion%20cobros%20lectura&state=CSRF
       [&code_challenge=BASE64URL_SHA256(verifier)]
   ```

2. El taller inicia sesión / se registra en facturá. y ve la pantalla de
   consentimiento con los permisos pedidos. (Exposición de marca.)

3. facturá. redirige a `redirect_uri?code=...&state=...` (o `?error=...`).

4. La app externa canjea el código (server-to-server):

   ```
   POST {FACTURA_URL}/api/oauth/token
   Content-Type: application/json
   { "grant_type":"authorization_code", "client_id":"...", "client_secret":"...",
     "code":"...", "redirect_uri":"...", "code_verifier":"..." }
   ```

   Respuesta:

   ```json
   { "access_token":"...", "refresh_token":"...", "token_type":"Bearer",
     "expires_in":3600, "scope":"facturacion cobros lectura", "negocio_id":"uuid" }
   ```

   El `access_token` dura 1 h. Renová con
   `{ "grant_type":"refresh_token", "client_id","client_secret","refresh_token" }`
   (el refresh **rota**: guardá siempre el nuevo).

Guardá `access_token`, `refresh_token`, `expires_in` y `negocio_id` contra el
negocio del taller en tu app.

## Scopes

| Scope | Permite |
| --- | --- |
| `lectura` | `GET /api/partners/negocio` (estado fiscal + conexión) |
| `facturacion` | Emitir facturas en ARCA |
| `cobros` | Crear cobros de Mercado Pago |

## Endpoints (Bearer)

Todos requieren `Authorization: Bearer {access_token}`.

### `GET /api/partners/negocio`  · scope `lectura`
Estado del negocio vinculado — para saber si ya puede facturar/cobrar:

```json
{
  "negocio": { "id","nombre","razon_social","cuit","condicion_iva","punto_venta" },
  "facturacion": { "habilitada":true, "estado_cuenta":"activo",
                   "arca_conectado":true, "arca_modo":"delegado" },
  "cobros": { "mp_conectado":true, "auto_facturar":false }
}
```

### `POST /api/partners/facturas`  · scope `facturacion`
Crea y (por defecto) emite en ARCA. Devuelve CAE + PDF.

```json
// request
{
  "receptor": { "doc_nro":"20304050607", "nombre":"Juan Pérez",
                "condicion_iva":"consumidor_final", "email":"...", "telefono":"..." },
  "items": [ { "descripcion":"Cambio de pantalla", "cantidad":1, "precio_unitario":45000 } ],
  "tipo": null,        // opcional: 'A'|'B'|'C'. null = automático por condición del emisor
  "emitir": true       // opcional. false = deja el borrador sin emitir
}
// response
{
  "factura": { "id","numero","tipo","total","estado":"emitida","cae","cae_vencimiento" },
  "pdf_url": "{FACTURA_URL}/api/facturas/{id}/pdf"
}
```
`receptor` puede omitirse (consumidor final genérico). Si el negocio no tiene
ARCA conectado o el trial venció, responde `422` con el motivo.

### `GET /api/partners/facturas/{id}`  · scope `lectura`
Estado de una factura (para reconciliación) + `pdf_url`.

### `GET /api/partners/terminales`  · scope `cobros`
Lista las terminales Point vinculadas a la cuenta MP del negocio (para
ofrecerle al taller elegir en cuál cobrar). El `id` de cada terminal es el
`terminal_id` que se usa en `POST /api/partners/cobros`.

```json
{ "terminales": [ { "id":"NEWLAND_N950__N950NCB801293324",
                    "operating_mode":"STANDALONE", "store_id":null, "pos_id":null } ] }
```

### `PATCH /api/partners/terminales`  · scope `cobros`
Cambia el modo de operación de una terminal. **Normalmente no hace falta**:
crear un cobro Point ya pone la terminal en `PDV` automáticamente. Se expone
para casos donde quieras controlarlo (ej. devolverla a `STANDALONE` para
cobros manuales).

```json
// request
{ "terminal_id":"NEWLAND_N950__N950NCB801293324", "modo":"PDV" }  // "PDV" | "STANDALONE"
// response
{ "terminal_id":"NEWLAND_N950__N950NCB801293324", "modo":"PDV" }
```
`PDV` = integrada (recibe órdenes por API). `STANDALONE` = se cobra tocando la
terminal a mano. Solo funciona en los modelos que MP habilita para integración
(NEWLAND_N950, INGENICO_MOVE2500, GERTEC_MP35P, PAX_A910, PAX_Q92).

### `POST /api/partners/cobros`  · scope `cobros`
Crea un cobro de Mercado Pago en la cuenta MP del negocio: por default un
link/QR de Checkout Pro, o —pasando `metodo:"point"`— lo manda a cobrar a una
terminal física Point del negocio (el cliente pasa la tarjeta ahí). La
confirmación llega por webhook.

```json
// request (QR / link — default)
{
  "monto": 45000,
  "descripcion": "Orden #1234 — saldo",
  "external_reference": "sm-venta-1234",  // tu id (idempotencia)
  "facturar": true                          // al aprobarse el pago, factura y emite
}
// response
{ "cobro_id":"uuid", "estado":"pendiente", "metodo":"qr",
  "init_point":"https://www.mercadopago.com/checkout/...", "preference_id":"..." }
```

```json
// request (terminal Point)
{
  "monto": 45000,
  "descripcion": "Orden #1234 — saldo",
  "external_reference": "sm-venta-1234",
  "metodo": "point",
  "terminal_id": "NEWLAND_N950__N950NCB801293324"  // de GET /api/partners/terminales
}
// response
{ "cobro_id":"uuid", "estado":"pendiente", "metodo":"point", "order_id":"..." }
```
Con `metodo:"point"` no hay `init_point`: el cobro se dispara directo en la
terminal del taller. facturá. **pone la terminal en modo PDV automáticamente**
antes de mandar la orden, así que no hace falta configurar nada en Mercado
Pago (tené en cuenta que eso saca a la terminal del modo STANDALONE / cobro
manual mientras esté integrada). Si el negocio no tiene MP conectado en
facturá., o no manda `terminal_id`, responde `409`/`400` respectivamente.

> **Nota:** esta integración con Point no se pudo probar de punta a punta
> contra una terminal física real antes de este release — validá el flujo
> completo con un dispositivo real antes de confiar en él en producción.

### `GET /api/partners/cobros/{id}`  · scope `cobros`
Polling del estado del cobro + factura asociada (si ya se emitió). Incluye
`metodo`, y si es Point también `mp_order_id`/`terminal_id`.

## Webhook saliente (facturá. → tu app)

Cuando un cobro cambia de estado, facturá. hace `POST` al `webhook_url` de tu
app, firmado con HMAC-SHA256 del cuerpo usando tu `webhook_secret`, en el
header `x-factura-signature`. Verificá la firma antes de confiar en el cuerpo.

```json
{
  "event": "cobro.aprobado",           // o "cobro.rechazado"
  "cobro_id": "uuid",
  "estado": "aprobado",
  "mp_payment_id": "123456789",
  "monto": 45000,
  "factura": { "id","numero","tipo","cae","cae_vencimiento","total","estado",
               "pdf_url": "{FACTURA_URL}/api/facturas/{id}/pdf" }  // null si no se facturó
}
```
El webhook es best-effort: si tu endpoint falla, reconciliá con
`GET /api/partners/cobros/{id}`. Para cobros con `metodo:"point"`, tratá el
webhook de forma idempotente por `cobro_id` + `estado`: Mercado Pago puede
notificar la orden y el pago subyacente por separado, así que en teoría
podrías recibir el mismo evento más de una vez.

## Seguridad

- Tokens guardados solo como hash SHA-256; el valor en claro se entrega una vez.
- `access_token` de 1 h; `refresh_token` rota en cada uso.
- Tablas `partner_*` y `cobros` con RLS: escritura solo `service_role`; el
  negocio puede leer sus propios `cobros` desde el panel.
- Solo el **admin** del negocio puede autorizar una app en la pantalla de
  consentimiento.
- La app externa nunca ve certificados de ARCA ni tokens de Mercado Pago.
