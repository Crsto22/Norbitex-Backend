CREATE TYPE "SunatBajaEstado" AS ENUM (
  'no_aplica',
  'pendiente_envio',
  'enviando',
  'pendiente_cdr',
  'aceptado',
  'observado',
  'rechazado',
  'error_transitorio',
  'error_definitivo'
);

CREATE TYPE "SunatBajaTipo" AS ENUM ('RA', 'RC');

ALTER TYPE "SunatJobTipoDocumento" ADD VALUE IF NOT EXISTS 'baja_lote';

CREATE TABLE "sunat_baja_lote" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "tipo_envio" "SunatBajaTipo" NOT NULL,
  "fecha_documento" DATE NOT NULL,
  "fecha_generacion" DATE NOT NULL,
  "correlativo" INTEGER NOT NULL,
  "estado" "SunatBajaEstado" NOT NULL DEFAULT 'pendiente_envio',
  "codigo" VARCHAR(20),
  "mensaje" VARCHAR(500),
  "ticket_sunat" VARCHAR(120),
  "sunat_hash" VARCHAR(120),
  "sunat_xml_nombre" VARCHAR(180),
  "sunat_xml_key" VARCHAR(600),
  "sunat_zip_nombre" VARCHAR(180),
  "sunat_zip_key" VARCHAR(600),
  "sunat_cdr_nombre" VARCHAR(180),
  "sunat_cdr_key" VARCHAR(600),
  "sunat_enviado_at" TIMESTAMPTZ(6),
  "sunat_respondido_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sunat_baja_lote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sunat_baja_item" (
  "id" BIGSERIAL NOT NULL,
  "lote_id" BIGINT NOT NULL,
  "venta_id" BIGINT NOT NULL,
  "tipo_comprobante" "VentaTipoComprobante" NOT NULL,
  "serie" VARCHAR(4) NOT NULL,
  "numero" INTEGER NOT NULL,
  "fecha_documento" DATE NOT NULL,
  "motivo" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sunat_baja_item_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "venta"
  ADD COLUMN "tipo_anulacion" VARCHAR(20),
  ADD COLUMN "sunat_baja_estado" "SunatBajaEstado",
  ADD COLUMN "sunat_baja_codigo" VARCHAR(20),
  ADD COLUMN "sunat_baja_mensaje" VARCHAR(500),
  ADD COLUMN "sunat_baja_ticket" VARCHAR(120),
  ADD COLUMN "sunat_baja_tipo" "SunatBajaTipo",
  ADD COLUMN "sunat_baja_lote_id" BIGINT,
  ADD COLUMN "sunat_baja_solicitada_at" TIMESTAMPTZ(6),
  ADD COLUMN "sunat_baja_respondida_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "sunat_baja_lote_empresa_id_tipo_envio_fecha_generacion_correlativo_key"
  ON "sunat_baja_lote"("empresa_id", "tipo_envio", "fecha_generacion", "correlativo");
CREATE INDEX "sunat_baja_lote_empresa_id_idx" ON "sunat_baja_lote"("empresa_id");
CREATE INDEX "sunat_baja_lote_estado_idx" ON "sunat_baja_lote"("estado");
CREATE INDEX "sunat_baja_lote_tipo_envio_fecha_documento_fecha_generacion_idx"
  ON "sunat_baja_lote"("tipo_envio", "fecha_documento", "fecha_generacion");

CREATE UNIQUE INDEX "sunat_baja_item_venta_id_key" ON "sunat_baja_item"("venta_id");
CREATE INDEX "sunat_baja_item_lote_id_idx" ON "sunat_baja_item"("lote_id");
CREATE INDEX "sunat_baja_item_fecha_documento_idx" ON "sunat_baja_item"("fecha_documento");

CREATE INDEX "venta_empresa_id_sunat_baja_estado_idx" ON "venta"("empresa_id", "sunat_baja_estado");
CREATE INDEX "venta_sunat_baja_lote_id_idx" ON "venta"("sunat_baja_lote_id");

ALTER TABLE "sunat_baja_lote"
  ADD CONSTRAINT "sunat_baja_lote_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sunat_baja_item"
  ADD CONSTRAINT "sunat_baja_item_lote_id_fkey"
  FOREIGN KEY ("lote_id") REFERENCES "sunat_baja_lote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sunat_baja_item"
  ADD CONSTRAINT "sunat_baja_item_venta_id_fkey"
  FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venta"
  ADD CONSTRAINT "venta_sunat_baja_lote_id_fkey"
  FOREIGN KEY ("sunat_baja_lote_id") REFERENCES "sunat_baja_lote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
