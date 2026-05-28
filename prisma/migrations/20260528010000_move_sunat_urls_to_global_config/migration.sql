CREATE TYPE "SunatEndpointCodigo" AS ENUM ('BILL_SERVICE', 'CONSULTA_TICKET', 'API_TOKEN', 'API_CPE');

CREATE TABLE "sunat_endpoint_config" (
    "id" BIGSERIAL NOT NULL,
    "ambiente" "SunatAmbiente" NOT NULL,
    "codigo" "SunatEndpointCodigo" NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sunat_endpoint_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sunat_endpoint_config_ambiente_codigo_key" ON "sunat_endpoint_config"("ambiente", "codigo");
CREATE INDEX "sunat_endpoint_config_ambiente_idx" ON "sunat_endpoint_config"("ambiente");
CREATE INDEX "sunat_endpoint_config_activo_idx" ON "sunat_endpoint_config"("activo");

ALTER TABLE "sunat_config" DROP COLUMN "url_bill_service";
ALTER TABLE "sunat_config" DROP COLUMN "url_consulta_ticket";
ALTER TABLE "sunat_config" DROP COLUMN "url_api_token";
ALTER TABLE "sunat_config" DROP COLUMN "url_api_cpe";
