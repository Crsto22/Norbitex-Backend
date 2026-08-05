# Norbitex Backend

API multiempresa para ventas, inventario, facturacion electronica, planes y administracion de Norbitex.

## Desarrollo

```bash
npm ci
npm run db:deploy
npm run start:dev
```

## Validacion

```bash
npm run check
npm run test:e2e -- --runInBand
npx prisma validate
```

## Produccion

Consulta [PRODUCTION.md](./PRODUCTION.md) y completa `.env.production.example` antes del despliegue.

```bash
npm ci
npm run db:deploy
npm run check
npm run start:prod
```

Disponibilidad: `GET /health`.
