# Integracion con shalom-service v1

Permite registrar una guia de Shalom desde Nuvex (registro individual) y mantener el estado
actualizado por webhooks.

## Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `SHALOM_SERVICE_URL` | sí | URL base del microservicio (ej. `https://shalom-api.nuvex.pe`) |
| `SHALOM_SERVICE_ADMIN_KEY` | sí (para conectar empresas) | `ADMIN_TOKEN` del microservicio; crea empresa/app/API key/webhook |
| `SHALOM_WEBHOOK_PUBLIC_URL` | recomendada | URL pública del backend Nuvex (ej. `https://api.nuvex.pe`). Sin ella no se registra el webhook |
| `SHALOM_SERVICE_TIMEOUT_MS` | opcional | timeout de las llamadas (default 60000) |
| `SUNAT_SECRETS_ENCRYPTION_KEY` | sí | cifra la API key y el secreto de webhook por empresa |

Bloque listo para pegar en el `.env`:

```ini
SHALOM_SERVICE_URL=https://shalom-api.nuvex.pe
SHALOM_SERVICE_ADMIN_KEY=<ADMIN_TOKEN del microservicio>
SHALOM_WEBHOOK_PUBLIC_URL=https://api.nuvex.pe
SHALOM_SERVICE_TIMEOUT_MS=90000
```

> `SHALOM_SERVICE_ADMIN_KEY` debe ser el token **rotado**; cualquier token compartido en un chat
> se considera comprometido. Cambiarlo no afecta a las empresas ya conectadas (solo se usa al
> provisionar o revalidar).

## Conexion por empresa (modulo `shalom-pro`)

| Método | Ruta | Quién |
| --- | --- | --- |
| `GET` | `/company/shalom-pro` | OWNER / ADMIN con módulo `shalom-pro` |
| `POST` | `/company/shalom-pro/provision` | OWNER / ADMIN |
| `POST` | `/company/shalom-pro/validate` | OWNER / ADMIN |
| `POST` | `/company/shalom-pro/webhook` | OWNER / ADMIN — registra el webhook si quedó pendiente |

`provision` recibe `{ username, password, packageType? }`, crea el tenant en el microservicio
(código `<slug>-<ruc>`), registra el webhook `order.registered` y guarda cifrados la API key y el
secreto. **La contraseña de Shalom no se guarda en Nuvex.**

## Registro individual desde "Entregas y envíos"

Con la cuenta conectada, cada envío por Shalom muestra el botón **Registrar en Shalom**
(solo OWNER/ADMIN ven la conexión; cualquier usuario con el módulo `shalom-pro` registra).

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/sales/:publicId/shalom-register` | encola el registro (job asíncrono) |
| `POST` | `/sales/shalom-register-bulk` | registro masivo (máx. 50, máx. 10 por destinatario) |
| `GET` | `/sales/:publicId/shalom` | estado del registro |
| `POST` | `/sales/:publicId/shalom-sync` | sincroniza el resultado del job (fallback del webhook) |
| `POST` | `/sales/:publicId/shalom-track` | rastreo manual: consulta el estado actual en Shalom (cooldown 60 s) |
| `GET` | `/sales/dni/:dni` | búsqueda RENIEC desde el modal (consume 1 consulta del plan) |

Requisitos: cuenta `ACTIVE`, envío `recibido`, agencia destino válida y agencia de origen
configurada en **Configuración → Shalom PRO** (`empresa_shalom_export_config.origen`). El modal
permite cambiar el origen para un envío puntual sin sobrescribir la configuración.

El registro es uno por venta (una guía por envío). El **despacho automático** se dispara cuando
Shalom reporta `EN_ORIGEN` (recepción en agencia), no al crear la guía.

### Registro masivo

`POST /sales/shalom-register-bulk` con `{ publicIds[], securityKey, packageType? }`.

- Máximo **50 envíos** por lote y máximo **10 por destinatario** (mismo documento).
- **Una sola clave de retiro** para todo el lote (4 dígitos, sin consecutivos ni repetidos).
- Responde `results[]` por envío (`ok`, `jobId`, `error`, `alreadyRegistered`) y `totals`.
- Cada envío se encola como el registro individual; la cola procesa **uno por uno por empresa**
  (~1-2 min cada uno), por lo que un lote de 50 puede tardar 50-90 min.

## Rastreo del estado

El microservicio rastrea las órdenes activas y emite `order.status_changed`
(`status`, `label`, `progress`, `message`, `steps`). Nuvex guarda `shalom_estado_label`,
`shalom_progreso` y `shalom_timeline` para dibujar el avance en la fila.

Para que avance solo, en el microservicio:

```ini
SHALOM_TRACKING_ENABLED=true
SHALOM_TRACKING_INTERVAL_MINUTES=45
```

El botón de actualizar del envío llama a `POST /sales/:publicId/shalom-track`, que consulta
Shalom en vivo (10-20 s) con un cooldown de 60 s por envío.

### Vencimiento de la guía

Si el paquete no se recepciona en la agencia dentro de `SHALOM_ORDER_EXPIRY_HOURS`
(24 h por defecto), el microservicio marca la orden como `ANULADO` y emite
`order.status_changed` con `label = "Guía vencida"`.

- **Aún no despachado**: el envío vuelve a Pendiente, se limpian orden/código y se habilita
  generar una nueva guía (el botón dice “Generar nueva guía”).
- **Ya despachado**: no se retrocede; se marca Incidencia con la nota correspondiente.

El despacho automático ocurre cuando Shalom reporta `EN_ORIGEN` (recepción en agencia), no al crear
la guía.

## Configuracion por empresa

`PUT /company/shalom-config` (requiere módulo `empresa`):

```json
{
  "tenantId": "uuid-del-tenant-en-shalom-service",
  "applicationId": "uuid-opcional",
  "apiKey": "shm_live_...",
  "webhookSecret": "whsec_...",
  "defaultPackageType": "PAQUETE S"
}
```

`GET /company/shalom-config` devuelve el estado sin exponer secretos.

La API key y el secreto se guardan cifrados (AES-256-GCM) con `SecretsCryptoService`.

## Registrar una guia

`POST /sales/:publicId/shalom-register` (módulo `entregas-pendientes`):

```json
{ "securityKey": "9872", "packageType": "PAQUETE S" }
```

Reglas:
- El envio debe ser de agencia `SHALOM` y tener DNI del destinatario.
- La agencia de **origen** se toma de los ajustes de exportación (`empresa_shalom_export_config.origen`).
- La agencia de **destino** se toma de `venta_envio.agencia_nombre`.
- `externalRef` = `venta_envio.codigo_publico` (idempotencia: reintentar no duplica la guía).
- Idempotency-Key enviada al microservicio: `envio:<codigo_publico>`.
- Si el job falla, el mensaje queda en `venta_envio.shalom_error`.

### Nombres y apellidos del destinatario

Shalom pide `nombres`, `apellido paterno` y `apellido materno` por separado. El enlace
público guarda el nombre completo y, además, las columnas separadas
(`venta_envio.nombres`, `apellido_paterno`, `apellido_materno`) cuando RENIEC las
devuelve. Al registrar se resuelve en este orden:

1. Datos enviados en el modal (`recipientName`, `recipientPaternalLastName`, `recipientMaternalLastName`).
2. Columnas separadas del envío.
3. División automática de `nombre_completo` (`src/common/person-name.ts`), con soporte
   para apellidos compuestos (`DE LA CRUZ`, `DEL AGUILA`, ...).

Si tras eso falta un campo obligatorio, el job falla como `PERMANENT` indicando el dato
exacto que debe completarse en Nuvex.


Respuesta: `{ jobId, status }`. Si la guía ya estaba registrada devuelve `alreadyRegistered: true`.

## Estado

- `GET /sales/:publicId/shalom` — lee lo guardado en `venta_envio` (sin llamar al microservicio).
- `POST /sales/:publicId/shalom-sync` — consulta el job y aplica el resultado si el webhook no llegó.

Campos nuevos en `venta_envio`: `shalom_job_id`, `shalom_orden`, `shalom_codigo`,
`shalom_monto`, `shalom_estado`, `shalom_error`, `shalom_registrado_at`, `shalom_sync_at`.

## Webhooks

`POST /shalom/webhooks` (público, requiere `X-Shalom-Signature`):

```http
X-Shalom-Signature: t=1731850000,v1=<hmac_sha256(secret, "t.body")>
```

- La firma se verifica contra el secreto de la empresa, con tolerancia de 5 minutos.
- El envío se localiza por `data.externalRef` = `codigo_publico`.
- `order.registered` → guarda orden, código, monto y fecha; registra historial.
- `order.status_changed` → mapea a `estado_logistico` y registra historial solo si cambió:

| Estado Shalom | `estado_logistico` |
| --- | --- |
| EN_ORIGEN | `POR_DESPACHAR` |
| EN_TRANSITO | `EN_TRANSITO` |
| ENTREGADO | `ENTREGADO` (+ `entregado_at`) |
| INCIDENCIA | `INCIDENCIA` |
| REGISTRADO / ANULADO | sin cambio |

## Migración

`prisma/migrations/20261117030000_shalom_integration/migration.sql`:
crea `empresa_shalom_integration`, el enum `ShalomIntegrationStatus` y las columnas
`shalom_*` en `venta_envio` con sus índices.
