CREATE TYPE "VentaEntregaEstado" AS ENUM ('pendiente', 'parcial', 'entregada');

ALTER TABLE "venta"
ADD COLUMN "codigo_interno" VARCHAR(20),
ADD COLUMN "recojo_posterior" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recojo_hasta" DATE,
ADD COLUMN "estado_entrega" "VentaEntregaEstado" NOT NULL DEFAULT 'entregada';

WITH numbered AS (
  SELECT
    "id",
    "empresa_id",
    EXTRACT(YEAR FROM "created_at")::INT AS "anio",
    ROW_NUMBER() OVER (
      PARTITION BY "empresa_id", EXTRACT(YEAR FROM "created_at")::INT
      ORDER BY "created_at", "id"
    ) AS "numero"
  FROM "venta"
)
UPDATE "venta" v
SET "codigo_interno" = 'VTA-' || n."anio" || '-' || LPAD(n."numero"::TEXT, 6, '0')
FROM numbered n
WHERE v."id" = n."id";

ALTER TABLE "venta"
ALTER COLUMN "codigo_interno" SET NOT NULL;

ALTER TABLE "venta_detalle"
ADD COLUMN "cantidad_entregada" INTEGER NOT NULL DEFAULT 0;

UPDATE "venta_detalle"
SET "cantidad_entregada" = "cantidad";

CREATE TABLE "venta_codigo_interno_secuencia" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "anio" INTEGER NOT NULL,
  "numero_actual" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venta_codigo_interno_secuencia_pkey" PRIMARY KEY ("id")
);

INSERT INTO "venta_codigo_interno_secuencia" ("empresa_id", "anio", "numero_actual")
SELECT
  "empresa_id",
  EXTRACT(YEAR FROM "created_at")::INT AS "anio",
  COUNT(*)::INT AS "numero_actual"
FROM "venta"
GROUP BY "empresa_id", EXTRACT(YEAR FROM "created_at")::INT
ON CONFLICT DO NOTHING;

CREATE TABLE "venta_entrega" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "venta_id" BIGINT NOT NULL,
  "entregado_por_id" BIGINT,
  "retirante_dni" VARCHAR(20),
  "retirante_nombre" VARCHAR(150),
  "notas" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venta_entrega_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "venta_entrega_detalle" (
  "id" BIGSERIAL NOT NULL,
  "entrega_id" BIGINT NOT NULL,
  "venta_detalle_id" BIGINT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venta_entrega_detalle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venta_empresa_id_codigo_interno_key" ON "venta"("empresa_id", "codigo_interno");
CREATE INDEX "venta_empresa_id_recojo_posterior_estado_entrega_created_at_idx" ON "venta"("empresa_id", "recojo_posterior", "estado_entrega", "created_at");
CREATE INDEX "venta_codigo_interno_idx" ON "venta"("codigo_interno");
CREATE UNIQUE INDEX "venta_codigo_interno_secuencia_empresa_id_anio_key" ON "venta_codigo_interno_secuencia"("empresa_id", "anio");
CREATE INDEX "venta_codigo_interno_secuencia_empresa_id_idx" ON "venta_codigo_interno_secuencia"("empresa_id");
CREATE UNIQUE INDEX "venta_entrega_public_id_key" ON "venta_entrega"("public_id");
CREATE INDEX "venta_entrega_venta_id_idx" ON "venta_entrega"("venta_id");
CREATE INDEX "venta_entrega_entregado_por_id_idx" ON "venta_entrega"("entregado_por_id");
CREATE INDEX "venta_entrega_created_at_idx" ON "venta_entrega"("created_at");
CREATE INDEX "venta_entrega_detalle_entrega_id_idx" ON "venta_entrega_detalle"("entrega_id");
CREATE INDEX "venta_entrega_detalle_venta_detalle_id_idx" ON "venta_entrega_detalle"("venta_detalle_id");

ALTER TABLE "venta_codigo_interno_secuencia"
ADD CONSTRAINT "venta_codigo_interno_secuencia_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venta_entrega"
ADD CONSTRAINT "venta_entrega_venta_id_fkey"
FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venta_entrega"
ADD CONSTRAINT "venta_entrega_entregado_por_id_fkey"
FOREIGN KEY ("entregado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "venta_entrega_detalle"
ADD CONSTRAINT "venta_entrega_detalle_entrega_id_fkey"
FOREIGN KEY ("entrega_id") REFERENCES "venta_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venta_entrega_detalle"
ADD CONSTRAINT "venta_entrega_detalle_venta_detalle_id_fkey"
FOREIGN KEY ("venta_detalle_id") REFERENCES "venta_detalle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT "id", 'entregas-pendientes'
FROM "empresa_usuario"
ON CONFLICT ("empresa_usuario_id", "module_key") DO NOTHING;
