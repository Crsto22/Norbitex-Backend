CREATE TYPE "BillingEnvironment" AS ENUM ('BETA', 'PRODUCTION');
CREATE TYPE "BillingIntegrationStatus" AS ENUM ('PENDING', 'READY', 'ERROR', 'DISABLED');
CREATE TYPE "BillingDocumentStatus" AS ENUM ('QUEUED', 'PROCESSING', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'RETRY_SCHEDULED', 'FAILED');
CREATE TYPE "BillingOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'DONE', 'DEAD');
CREATE TYPE "BillingOutboxOperation" AS ENUM ('ISSUE');

ALTER TABLE "empresa" ADD COLUMN "billing_microservice_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "serie_comprobante" ADD COLUMN "numero_provisional_actual" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "venta"
  ADD COLUMN "billing_document_id" UUID,
  ADD COLUMN "billing_environment" "BillingEnvironment",
  ADD COLUMN "billing_status" "BillingDocumentStatus",
  ADD COLUMN "billing_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_sunat_observations" JSONB,
  ADD COLUMN "billing_last_error" VARCHAR(1000),
  ADD COLUMN "billing_attempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "venta_billing_document_id_key" ON "venta"("billing_document_id");

CREATE TABLE "billing_integration" (
  "id" BIGSERIAL PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL UNIQUE REFERENCES "empresa"("id") ON DELETE CASCADE,
  "tenant_id" UUID,
  "application_id" UUID,
  "environment" "BillingEnvironment" NOT NULL DEFAULT 'BETA',
  "beta_api_key_encrypted" TEXT,
  "production_api_key_encrypted" TEXT,
  "beta_credentials_configured" BOOLEAN NOT NULL DEFAULT false,
  "production_credentials_configured" BOOLEAN NOT NULL DEFAULT false,
  "beta_certificate_configured" BOOLEAN NOT NULL DEFAULT false,
  "production_certificate_configured" BOOLEAN NOT NULL DEFAULT false,
  "beta_webhook_endpoint_id" UUID,
  "production_webhook_endpoint_id" UUID,
  "beta_webhook_secret_encrypted" TEXT,
  "production_webhook_secret_encrypted" TEXT,
  "status" "BillingIntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "last_error" VARCHAR(1000),
  "last_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "billing_integration_tenant_id_idx" ON "billing_integration"("tenant_id");
CREATE INDEX "billing_integration_application_id_idx" ON "billing_integration"("application_id");

CREATE TABLE "billing_establishment_mapping" (
  "id" BIGSERIAL PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "sucursal_id" BIGINT NOT NULL REFERENCES "sucursal"("id") ON DELETE CASCADE,
  "environment" "BillingEnvironment" NOT NULL,
  "billing_establishment_id" UUID NOT NULL,
  "code" VARCHAR(10) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX "billing_establishment_mapping_sucursal_id_environment_key" ON "billing_establishment_mapping"("sucursal_id", "environment");
CREATE UNIQUE INDEX "billing_establishment_mapping_empresa_id_environment_code_key" ON "billing_establishment_mapping"("empresa_id", "environment", "code");
CREATE INDEX "billing_establishment_mapping_empresa_id_environment_idx" ON "billing_establishment_mapping"("empresa_id", "environment");

CREATE TABLE "billing_series_mapping" (
  "id" BIGSERIAL PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "serie_comprobante_id" BIGINT NOT NULL REFERENCES "serie_comprobante"("id") ON DELETE CASCADE,
  "environment" "BillingEnvironment" NOT NULL,
  "billing_fiscal_series_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX "billing_series_mapping_serie_comprobante_id_environment_key" ON "billing_series_mapping"("serie_comprobante_id", "environment");
CREATE INDEX "billing_series_mapping_empresa_id_environment_idx" ON "billing_series_mapping"("empresa_id", "environment");

CREATE TABLE "billing_outbox" (
  "id" UUID PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "venta_id" BIGINT NOT NULL REFERENCES "venta"("id") ON DELETE CASCADE,
  "environment" "BillingEnvironment" NOT NULL,
  "operation" "BillingOutboxOperation" NOT NULL DEFAULT 'ISSUE',
  "idempotency_key" VARCHAR(100) NOT NULL UNIQUE,
  "status" "BillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 12,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX "billing_outbox_venta_id_environment_operation_key" ON "billing_outbox"("venta_id", "environment", "operation");
CREATE INDEX "billing_outbox_status_next_attempt_at_idx" ON "billing_outbox"("status", "next_attempt_at");
CREATE INDEX "billing_outbox_empresa_id_status_idx" ON "billing_outbox"("empresa_id", "status");

CREATE TABLE "billing_webhook_event" (
  "event_id" UUID PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "application_id" UUID NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "event_created_at" TIMESTAMPTZ(6) NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "billing_webhook_event_empresa_id_processed_at_idx" ON "billing_webhook_event"("empresa_id", "processed_at");
