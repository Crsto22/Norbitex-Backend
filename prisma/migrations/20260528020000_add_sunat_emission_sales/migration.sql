-- CreateEnum
CREATE TYPE "SunatEstado" AS ENUM (
  'no_aplica',
  'pendiente_envio',
  'enviando',
  'aceptado',
  'observado',
  'rechazado',
  'error_transitorio',
  'error_definitivo'
);

-- CreateEnum
CREATE TYPE "SunatJobTipoDocumento" AS ENUM ('venta');

-- CreateEnum
CREATE TYPE "SunatJobEstado" AS ENUM (
  'pendiente_envio',
  'procesando',
  'finalizado',
  'error_definitivo'
);

-- AlterTable
ALTER TABLE "venta"
  ADD COLUMN "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  ADD COLUMN "forma_pago" VARCHAR(10) NOT NULL DEFAULT 'CONTADO',
  ADD COLUMN "igv_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  ADD COLUMN "op_gravadas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "op_exoneradas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "op_inafectas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igv_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sunat_estado" "SunatEstado" NOT NULL DEFAULT 'no_aplica',
  ADD COLUMN "sunat_codigo" VARCHAR(20),
  ADD COLUMN "sunat_mensaje" VARCHAR(500),
  ADD COLUMN "sunat_hash" VARCHAR(120),
  ADD COLUMN "sunat_xml_nombre" VARCHAR(180),
  ADD COLUMN "sunat_xml_key" VARCHAR(600),
  ADD COLUMN "sunat_zip_nombre" VARCHAR(180),
  ADD COLUMN "sunat_zip_key" VARCHAR(600),
  ADD COLUMN "sunat_cdr_nombre" VARCHAR(180),
  ADD COLUMN "sunat_cdr_key" VARCHAR(600),
  ADD COLUMN "sunat_enviado_at" TIMESTAMPTZ(6),
  ADD COLUMN "sunat_respondido_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "venta_detalle"
  ADD COLUMN "descripcion" VARCHAR(255),
  ADD COLUMN "unidad_medida_codigo" VARCHAR(10) NOT NULL DEFAULT 'NIU',
  ADD COLUMN "tipo_afectacion_igv_codigo" VARCHAR(4) NOT NULL DEFAULT '10',
  ADD COLUMN "valor_unitario" DECIMAL(12,10) NOT NULL DEFAULT 0,
  ADD COLUMN "valor_venta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igv_monto" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sunat_job" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "tipo_documento" "SunatJobTipoDocumento" NOT NULL,
  "documento_id" BIGINT NOT NULL,
  "estado" "SunatJobEstado" NOT NULL DEFAULT 'pendiente_envio',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "max_intentos" INTEGER NOT NULL DEFAULT 10,
  "ultimo_error" VARCHAR(1000),
  "ultimo_codigo" VARCHAR(40),
  "next_retry_at" TIMESTAMPTZ(6),
  "locked_at" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "sunat_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sunat_job_tipo_documento_documento_id_key" ON "sunat_job"("tipo_documento", "documento_id");

-- CreateIndex
CREATE INDEX "sunat_job_empresa_id_idx" ON "sunat_job"("empresa_id");

-- CreateIndex
CREATE INDEX "sunat_job_estado_next_retry_at_idx" ON "sunat_job"("estado", "next_retry_at");

-- CreateIndex
CREATE INDEX "sunat_job_locked_at_idx" ON "sunat_job"("locked_at");

-- CreateIndex
CREATE INDEX "venta_empresa_id_sunat_estado_idx" ON "venta"("empresa_id", "sunat_estado");

-- AddForeignKey
ALTER TABLE "sunat_job" ADD CONSTRAINT "sunat_job_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed global endpoints for the first SUNAT emission flow. Superadmin UI can manage them later.
INSERT INTO "sunat_endpoint_config" ("ambiente", "codigo", "url", "activo", "created_at", "updated_at")
VALUES
  ('BETA', 'BILL_SERVICE', 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService', true, now(), now()),
  ('PRODUCCION', 'BILL_SERVICE', 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService', true, now(), now())
ON CONFLICT ("ambiente", "codigo") DO NOTHING;
