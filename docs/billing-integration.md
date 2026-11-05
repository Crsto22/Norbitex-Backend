# Nuvex Billing: boletas y facturas

Nuvex conserva la venta, caja, pagos, stock y cuentas por cobrar. Nuvex Billing
reserva la numeracion fiscal, genera los artefactos y procesa la respuesta de
SUNAT. La activacion es individual por empresa mediante
`empresa.billing_microservice_enabled`.

## Variables de entorno

```env
BILLING_API_URL=https://billing-api.nuvex.pe/v1
BILLING_PLATFORM_ADMIN_KEY=REEMPLAZAR
BILLING_WEBHOOK_PUBLIC_URL=https://api.nuvex.pe/billing/webhooks
BILLING_PLATFORM_WEBHOOK_PUBLIC_URL=https://api.nuvex.pe/billing/platform-webhooks
BILLING_REQUEST_TIMEOUT_MS=15000
PLATFORM_BILLING_MICROSERVICE_ENABLED=false
```

`BILLING_PLATFORM_ADMIN_KEY`, las API keys por empresa y los secretos webhook
nunca se envian al frontend. Las credenciales por empresa se cifran con
`SUNAT_SECRETS_ENCRYPTION_KEY`.

## Activacion

1. Ejecutar la migracion Prisma.
2. Desplegar con todas las empresas desactivadas.
3. Desde Configuracion > Empresa, provisionar BETA, cargar credenciales y
   certificado y activar la integracion.
4. Validar una boleta y una factura en BETA.
5. Repetir en PRODUCTION y activar la empresa.

La facturacion propia de Nuvex se provisiona desde el panel superadmin con una
aplicacion Billing independiente (`nuvex-platform`). Solo debe cambiarse
`PLATFORM_BILLING_MICROSERVICE_ENABLED=true` despues de validar BETA; los
comprobantes historicos sin `billingDocumentId` continúan usando sus archivos
locales en modo de solo lectura.

La activacion se bloquea si quedan trabajos del emisor SUNAT anterior en estado
pendiente o procesando. Esto evita que ambos emisores envien el mismo documento.

## Reglas tributarias verificadas

- Series de factura `F` + tres caracteres y boleta `B` + tres caracteres:
  [Guias y manuales CPE](https://cpe.sunat.gob.pe/guias-y-manuales).
- Las cuotas de una venta a credito corresponden al saldo neto pendiente:
  [Preguntas frecuentes CPE](https://cpe.sunat.gob.pe/informacion_general/preguntas_frecuentes)
  y [anexo de la RS 123-2022](https://www.sunat.gob.pe/legislacion/superin/2022/anexo-123-2022.pdf).
- El resumen diario agrupa documentos de una misma fecha de emision y puede
  enviarse hasta el septimo dia calendario:
  [RS 114-2019](https://www.sunat.gob.pe/legislacion/superin/2019/114-2019.pdf).
- Las observaciones de un CDR aceptado se conservan separadas del rechazo:
  [Manual del programador CPE](https://cpe.sunat.gob.pe/sites/default/files/inline-files/manual_programador%20%281%29.pdf).

La primera version integrada admite clientes sin documento, DNI y RUC. Para
boletas mayores a S/700 exige DNI o RUC; documentos de no domiciliados quedan
fuera de esta primera version.

## Notas de credito de empresas clientes

Cuando Billing esta activo, las notas `FC...` y `BC...` se registran primero en
Nuvex y se envian de forma asincrona a `/v1/credit-notes`. Billing asigna el
correlativo, valida el saldo del comprobante original y genera XML, CDR y PDF.
Las series de notas deben sincronizarse despues de desplegar esta version.

La devolucion de stock y la reduccion de cuentas por cobrar se ejecutan una sola
vez, unicamente cuando SUNAT acepta la nota. Las notas historicas sin
`billingDocumentId` conservan el emisor y los archivos anteriores.

## Bajas de boletas y facturas

Con la integracion activa, `PATCH /sales/:publicId/annul` registra una operacion
asíncrona `VOID` y exige `documentDelivered: false`. Billing procesa facturas
mediante Comunicacion de Baja (`RA`) y boletas mediante Resumen Diario (`RC`).
Nuvex no devuelve stock ni revierte pagos hasta recibir la aceptacion de SUNAT.

Las rutas de consulta y descarga permanecen bajo `/sales/:publicId/sunat/baja`;
Nuvex actua como proxy y nunca entrega la API key de Billing al navegador. Los
eventos `sunat_void.accepted`, `sunat_void.rejected` y `sunat_void.failed` se
validan con la misma firma HMAC del webhook de emision.

Regla normativa aplicada: una boleta no otorgada se comunica como anulada en el
Resumen Diario y debe remitirse dentro del plazo de siete dias calendario. Si el
comprobante ya fue entregado o puesto a disposicion del cliente, corresponde una
nota de credito. Fuente oficial consultada: [Boleta de Venta Electronica - SUNAT
(actualizada el 25/09/2025)](https://cpe.sunat.gob.pe/tipos_de_comprobantes/boleta).
# GRE Remitente

- Las series `T...` se sincronizan como `DESPATCH_GUIDE` por sucursal y ambiente.
- Los borradores permanecen en Nuvex y no consumen correlativo fiscal.
- Al emitir se crea `BillingDespatchGuideOutbox`; Billing asigna el numero,
  firma el XML, envia a SUNAT en produccion y devuelve CDR/PDF.
- `BETA` solo valida internamente como `VALIDATED_BETA`, sin aceptacion SUNAT.
- XML, CDR y PDF se transmiten por proxy; las GRE historicas conservan el flujo anterior.
- La baja de una GRE aceptada requiere SUNAT SOL y confirmacion posterior desde Nuvex.
