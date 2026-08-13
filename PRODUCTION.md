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
4. Ajustar `RATE_LIMIT_TTL_SECONDS`, `RATE_LIMIT_REQUESTS` y `TRUST_PROXY_HOPS` segun el proxy/balanceador real.
5. Ajustar `DB_POOL_CONNECTION_LIMIT` y `DB_POOL_TIMEOUT_SECONDS` segun el plan de PostgreSQL.
6. Configurar `METRICS_TOKEN` con un secreto interno.
7. Ejecutar:

```bash
npm ci
npm run db:deploy
npm run check
npm prune --omit=dev
npm run start:prod
```

## Operación

- Verificación de disponibilidad: `GET /health`.
- Metricas basicas de proceso HTTP: `GET /metrics` con `X-Metrics-Token: <METRICS_TOKEN>`.
- El proceso debe ejecutarse con systemd, PM2 o el supervisor del proveedor.
- El proxy debe enviar `X-Forwarded-For` y `X-Forwarded-Proto`.
- El rate limit global usa `Authorization` cuando existe y la IP para rutas publicas.
- En despliegues con multiples instancias, aplicar tambien rate limit distribuido en Cloudflare/Nginx/load balancer; el limitador de NestJS es por instancia.
- Limites especiales por minuto: auth 20, SUNAT 20, PDF 30, reportes 40, dashboard 60.
- `PDF_CONCURRENCY_LIMIT` limita cuantos PDFs se generan al mismo tiempo por instancia.
- `SUNAT_SOAP_TIMEOUT_SECONDS` corta llamadas SOAP colgadas antes de consumir workers indefinidamente.
- Respaldar PostgreSQL y `/var/lib/norbitex/storage`.
- No desplegar `.env`, logs, `node_modules`, `coverage` ni archivos temporales.
