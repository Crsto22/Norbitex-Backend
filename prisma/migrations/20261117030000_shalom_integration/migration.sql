-- Integracion con el microservicio shalom-service (registro individual).

CREATE TYPE "ShalomIntegrationStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR');

CREATE TABLE "empresa_shalom_integration" (
  "id" bigserial PRIMARY KEY,
  "empresa_id" bigint NOT NULL UNIQUE,
  "tenant_id" uuid NOT NULL,
  "application_id" uuid,
  "api_key_encrypted" text NOT NULL,
  "webhook_secret_encrypted" text,
  "default_package_type" varchar(30) NOT NULL DEFAULT 'PAQUETE S',
  "status" "ShalomIntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "last_error" varchar(1000),
  "last_synced_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "empresa_shalom_integration_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE
);

ALTER TABLE "venta_envio"
  ADD COLUMN "shalom_job_id" uuid,
  ADD COLUMN "shalom_orden" varchar(20),
  ADD COLUMN "shalom_codigo" varchar(10),
  ADD COLUMN "shalom_monto" decimal(10, 2),
  ADD COLUMN "shalom_estado" varchar(20),
  ADD COLUMN "shalom_error" varchar(500),
  ADD COLUMN "shalom_registrado_at" timestamptz(6),
  ADD COLUMN "shalom_sync_at" timestamptz(6);

CREATE INDEX "venta_envio_shalom_orden_idx" ON "venta_envio" ("shalom_orden");
CREATE INDEX "venta_envio_shalom_job_id_idx" ON "venta_envio" ("shalom_job_id");
