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
BILLING_REQUEST_TIMEOUT_MS=15000
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
