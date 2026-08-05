# Despliegue de Norbitex Backend

## Requisitos

- Node.js 22 o 24.
- PostgreSQL con copias de seguridad automáticas.
- HTTPS terminado en Nginx, Caddy o el proxy del proveedor.
- Directorio persistente para `LOCAL_STORAGE_DIR`.
- Chromium instalado para generar PDF.

## Preparación

1. Copiar `.env.production.example` como `.env` y reemplazar todos los valores.
2. Mantener `CORS_ORIGINS` limitado al dominio real del frontend.
3. Mantener `SUNAT_GUIA_REMISION_MODE=DISABLED` hasta implementar GRE REST real.
4. Ejecutar:

```bash
npm ci
npm run db:deploy
npm run check
npm prune --omit=dev
npm run start:prod
```

## Operación

- Verificación de disponibilidad: `GET /health`.
- El proceso debe ejecutarse con systemd, PM2 o el supervisor del proveedor.
- El proxy debe enviar `X-Forwarded-For` y `X-Forwarded-Proto`.
- Respaldar PostgreSQL y `/var/lib/norbitex/storage`.
- No desplegar `.env`, logs, `node_modules`, `coverage` ni archivos temporales.
