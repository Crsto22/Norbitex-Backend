CREATE TYPE "PlataformaSunatJobOperacion" AS ENUM ('emision', 'baja');

ALTER TABLE "comprobante_plataforma"
  ADD COLUMN "sunat_baja_request_id" UUID,
  ADD COLUMN "sunat_baja_estado" "SunatBajaEstado",
  ADD COLUMN "sunat_baja_tipo" "SunatBajaTipo",
  ADD COLUMN "sunat_baja_correlativo" INTEGER,
  ADD COLUMN "sunat_baja_motivo" VARCHAR(300),
  ADD COLUMN "sunat_baja_codigo" VARCHAR(20),
  ADD COLUMN "sunat_baja_mensaje" VARCHAR(500),
  ADD COLUMN "sunat_baja_ticket" VARCHAR(120),
  ADD COLUMN "sunat_baja_xml_r2_key" VARCHAR(600),
  ADD COLUMN "sunat_baja_cdr_r2_key" VARCHAR(600),
  ADD COLUMN "sunat_baja_solicitada_at" TIMESTAMPTZ(6),
  ADD COLUMN "sunat_baja_respondida_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "comprobante_plataforma_sunat_baja_request_id_key"
  ON "comprobante_plataforma"("sunat_baja_request_id");
CREATE INDEX "comprobante_plataforma_sunat_baja_estado_solicitada_idx"
  ON "comprobante_plataforma"("sunat_baja_estado", "sunat_baja_solicitada_at");

ALTER TABLE "comprobante_plataforma_sunat_job"
  ADD COLUMN "operacion" "PlataformaSunatJobOperacion" NOT NULL DEFAULT 'emision';

CREATE TABLE "secuencia_baja_plataforma" (
  "id" BIGSERIAL NOT NULL,
  "tipo" "SunatBajaTipo" NOT NULL,
  "fecha_generacion" DATE NOT NULL,
  "correlativo" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "secuencia_baja_plataforma_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "secuencia_baja_plataforma_tipo_fecha_key"
  ON "secuencia_baja_plataforma"("tipo", "fecha_generacion");
