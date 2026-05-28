-- AlterTable
ALTER TABLE "metodo_pago"
  ADD COLUMN "codigo" VARCHAR(40),
  ADD COLUMN "es_sistema" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "permite_vuelto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "venta_pago"
  ADD COLUMN "monto_recibido" DECIMAL(12,2),
  ADD COLUMN "vuelto" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill protected default payment methods per company.
WITH defaults(nombre, nombre_key, codigo, descripcion, permite_vuelto, orden) AS (
  VALUES
    ('Efectivo', 'efectivo', 'efectivo', 'Pago en efectivo', true, 1),
    ('Yape', 'yape', 'yape', 'Pago por Yape', false, 2),
    ('Plin', 'plin', 'plin', 'Pago por Plin', false, 3),
    ('Transferencia', 'transferencia', 'transferencia', 'Pago por transferencia bancaria', false, 4)
)
INSERT INTO "metodo_pago" (
  "empresa_id",
  "nombre",
  "nombre_key",
  "codigo",
  "descripcion",
  "es_sistema",
  "permite_vuelto",
  "orden",
  "estado",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  e."id",
  d.nombre,
  d.nombre_key,
  d.codigo,
  d.descripcion,
  true,
  d.permite_vuelto,
  d.orden,
  'activo'::"MetodoPagoEstado",
  NULL,
  now(),
  now()
FROM "empresa" e
CROSS JOIN defaults d
ON CONFLICT ("empresa_id", "nombre_key") DO UPDATE SET
  "nombre" = EXCLUDED."nombre",
  "codigo" = EXCLUDED."codigo",
  "descripcion" = COALESCE("metodo_pago"."descripcion", EXCLUDED."descripcion"),
  "es_sistema" = true,
  "permite_vuelto" = EXCLUDED."permite_vuelto",
  "orden" = EXCLUDED."orden",
  "estado" = 'activo'::"MetodoPagoEstado",
  "deleted_at" = NULL,
  "updated_at" = now();

-- CreateIndex
CREATE INDEX "metodo_pago_codigo_idx" ON "metodo_pago"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pago_empresa_id_codigo_key" ON "metodo_pago"("empresa_id", "codigo") WHERE "codigo" IS NOT NULL;
