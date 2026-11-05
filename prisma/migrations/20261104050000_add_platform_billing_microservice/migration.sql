ALTER TABLE "configuracion_facturacion_plataforma"
  ADD COLUMN "billing_microservice_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_tenant_id" UUID,
  ADD COLUMN "billing_application_id" UUID,
  ADD COLUMN "billing_establishment_id" UUID,
  ADD COLUMN "billing_status" "BillingIntegrationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "billing_last_error" VARCHAR(1000),
  ADD COLUMN "billing_last_synced_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_beta_api_key_encrypted" TEXT,
  ADD COLUMN "billing_production_api_key_encrypted" TEXT,
  ADD COLUMN "billing_beta_webhook_endpoint_id" UUID,
  ADD COLUMN "billing_production_webhook_endpoint_id" UUID,
  ADD COLUMN "billing_beta_webhook_secret_encrypted" TEXT,
  ADD COLUMN "billing_production_webhook_secret_encrypted" TEXT,
  ADD COLUMN "billing_beta_credentials_configured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_production_credentials_configured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_beta_certificate_configured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_production_certificate_configured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "comprobante_plataforma"
  ALTER COLUMN "numero" DROP NOT NULL,
  ADD COLUMN "billing_document_id" UUID,
  ADD COLUMN "billing_environment" "BillingEnvironment",
  ADD COLUMN "billing_status" "BillingDocumentStatus",
  ADD COLUMN "billing_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_last_error" VARCHAR(1000),
  ADD COLUMN "billing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "billing_void_request_id" UUID;

CREATE UNIQUE INDEX "comprobante_plataforma_billing_document_id_key"
  ON "comprobante_plataforma"("billing_document_id");
CREATE UNIQUE INDEX "comprobante_plataforma_billing_void_request_id_key"
  ON "comprobante_plataforma"("billing_void_request_id");

CREATE TABLE "platform_billing_series_mapping" (
  "id" BIGSERIAL PRIMARY KEY,
  "serie_id" BIGINT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "billing_fiscal_series_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "platform_billing_series_mapping_serie_id_fkey"
    FOREIGN KEY ("serie_id") REFERENCES "serie_comprobante_plataforma"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_billing_series_mapping_serie_id_environment_key"
  ON "platform_billing_series_mapping"("serie_id", "environment");
CREATE INDEX "platform_billing_series_mapping_environment_idx"
  ON "platform_billing_series_mapping"("environment");

CREATE TABLE "platform_billing_outbox" (
  "id" UUID PRIMARY KEY,
  "receipt_id" BIGINT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "operation" "BillingOutboxOperation" NOT NULL DEFAULT 'ISSUE',
  "idempotency_key" VARCHAR(140) NOT NULL,
  "status" "BillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 12,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "platform_billing_outbox_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "comprobante_plataforma"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_billing_outbox_idempotency_key_key"
  ON "platform_billing_outbox"("idempotency_key");
CREATE UNIQUE INDEX "platform_billing_outbox_receipt_id_environment_operation_key"
  ON "platform_billing_outbox"("receipt_id", "environment", "operation");
CREATE INDEX "platform_billing_outbox_status_next_attempt_at_idx"
  ON "platform_billing_outbox"("status", "next_attempt_at");

CREATE TABLE "platform_billing_webhook_event" (
  "event_id" UUID PRIMARY KEY,
  "application_id" UUID NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "event_created_at" TIMESTAMPTZ(6) NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "platform_billing_webhook_event_application_id_processed_at_idx"
  ON "platform_billing_webhook_event"("application_id", "processed_at");
