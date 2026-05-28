CREATE TYPE "SunatAmbiente" AS ENUM ('BETA', 'PRODUCCION');

CREATE TABLE "sunat_config" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "ambiente" "SunatAmbiente" NOT NULL DEFAULT 'BETA',
    "usuario_sol_encrypted" TEXT,
    "clave_sol_encrypted" TEXT,
    "client_id_encrypted" TEXT,
    "client_secret_encrypted" TEXT,
    "certificado_password_encrypted" TEXT,
    "certificado_r2_key" VARCHAR(600),
    "certificado_nombre" VARCHAR(180),
    "certificado_mime_type" VARCHAR(80),
    "certificado_size_bytes" INTEGER,
    "certificado_uploaded_at" TIMESTAMPTZ(6),
    "url_bill_service" VARCHAR(255),
    "url_consulta_ticket" VARCHAR(255),
    "url_api_token" VARCHAR(255),
    "url_api_cpe" VARCHAR(255),
    "igv_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sunat_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sunat_config_empresa_id_key" ON "sunat_config"("empresa_id");
CREATE INDEX "sunat_config_empresa_id_idx" ON "sunat_config"("empresa_id");
CREATE INDEX "sunat_config_activo_idx" ON "sunat_config"("activo");

ALTER TABLE "sunat_config" ADD CONSTRAINT "sunat_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
