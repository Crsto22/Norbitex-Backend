CREATE TYPE "LiquidacionExcedenteEstado" AS ENUM ('pendiente', 'pagado');

CREATE TABLE "tarifa_comprobante_excedente" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "precio_unitario" DECIMAL(12, 2) NOT NULL,
  "actualizado_por_id" BIGINT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifa_comprobante_excedente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tarifa_comprobante_excedente_singleton" CHECK ("id" = 1)
);

INSERT INTO "tarifa_comprobante_excedente" ("id", "precio_unitario") VALUES (1, 0.20);

CREATE TABLE "empresa_limite_adicional" (
  "empresa_id" BIGINT NOT NULL,
  "usuarios" BIGINT NOT NULL DEFAULT 0,
  "sucursales" BIGINT NOT NULL DEFAULT 0,
  "productos" BIGINT NOT NULL DEFAULT 0,
  "variantes" BIGINT NOT NULL DEFAULT 0,
  "comprobantes" BIGINT NOT NULL DEFAULT 0,
  "almacenamiento_bytes" BIGINT NOT NULL DEFAULT 0,
  "actualizado_por_id" BIGINT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_limite_adicional_pkey" PRIMARY KEY ("empresa_id"),
  CONSTRAINT "empresa_limite_adicional_non_negative" CHECK (
    "usuarios" >= 0 AND "sucursales" >= 0 AND "productos" >= 0 AND
    "variantes" >= 0 AND "comprobantes" >= 0 AND "almacenamiento_bytes" >= 0
  )
);

ALTER TABLE "venta"
ADD COLUMN "es_excedente_plan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "precio_excedente_plan" DECIMAL(12, 2);

CREATE TABLE "liquidacion_excedente" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "pago_request_id" UUID,
  "empresa_id" BIGINT NOT NULL,
  "periodo" VARCHAR(7) NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "monto_total" DECIMAL(12, 2) NOT NULL,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "incluye_igv" BOOLEAN NOT NULL DEFAULT true,
  "estado" "LiquidacionExcedenteEstado" NOT NULL DEFAULT 'pendiente',
  "metodo_pago" "PagoSuscripcionMetodo",
  "metodo_pago_otro" VARCHAR(80),
  "cerrada_por_id" BIGINT NOT NULL,
  "pagada_por_id" BIGINT,
  "pagado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liquidacion_excedente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "liquidacion_excedente_request_id_key" ON "liquidacion_excedente"("request_id");
CREATE UNIQUE INDEX "liquidacion_excedente_pago_request_id_key" ON "liquidacion_excedente"("pago_request_id");
CREATE UNIQUE INDEX "liquidacion_excedente_empresa_id_periodo_key" ON "liquidacion_excedente"("empresa_id", "periodo");
CREATE INDEX "liquidacion_excedente_estado_created_at_idx" ON "liquidacion_excedente"("estado", "created_at");
CREATE INDEX "liquidacion_excedente_empresa_id_created_at_idx" ON "liquidacion_excedente"("empresa_id", "created_at");
CREATE INDEX "empresa_limite_adicional_actualizado_por_id_idx" ON "empresa_limite_adicional"("actualizado_por_id");
CREATE INDEX "venta_empresa_id_es_excedente_plan_created_at_idx" ON "venta"("empresa_id", "es_excedente_plan", "created_at");

ALTER TABLE "tarifa_comprobante_excedente" ADD CONSTRAINT "tarifa_comprobante_excedente_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "empresa_limite_adicional" ADD CONSTRAINT "empresa_limite_adicional_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "empresa_limite_adicional" ADD CONSTRAINT "empresa_limite_adicional_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "liquidacion_excedente" ADD CONSTRAINT "liquidacion_excedente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "liquidacion_excedente" ADD CONSTRAINT "liquidacion_excedente_cerrada_por_id_fkey" FOREIGN KEY ("cerrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "liquidacion_excedente" ADD CONSTRAINT "liquidacion_excedente_pagada_por_id_fkey" FOREIGN KEY ("pagada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
