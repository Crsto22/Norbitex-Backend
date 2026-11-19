# Integracion con shalom-service v1

Permite registrar una guia de Shalom desde Nuvex (registro individual) y mantener el estado
actualizado por webhooks.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `SHALOM_SERVICE_URL` | URL base del microservicio (ej. `http://127.0.0.1:4100`). En producción debe ser HTTPS |
| `SHALOM_SERVICE_TIMEOUT_MS` | timeout de las llamadas (default 60000) |
| `SUNAT_SECRETS_ENCRYPTION_KEY` | cifra la API key y el secreto de webhook por empresa |

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
