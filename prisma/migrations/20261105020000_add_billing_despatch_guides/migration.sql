ALTER TABLE "guia_remision"
  ALTER COLUMN "numero" DROP NOT NULL,
  ALTER COLUMN "correlativo" DROP NOT NULL,
  ADD COLUMN "billing_document_id" UUID,
  ADD COLUMN "billing_environment" "BillingEnvironment",
  ADD COLUMN "billing_status" VARCHAR(60),
  ADD COLUMN "billing_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_last_error" VARCHAR(1000),
  ADD COLUMN "billing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "billing_void_request_id" UUID,
  ADD COLUMN "billing_void_status" VARCHAR(60),
  ADD COLUMN "billing_void_reference" VARCHAR(120),
  ADD COLUMN "billing_void_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_void_confirmed_at" TIMESTAMPTZ(6);

-- El catalogo 61 tambien admite documentos sin serie y referencias extensas
-- (por ejemplo DAM, manifiestos y autorizaciones especiales).
ALTER TABLE "guia_remision_documento_relacionado"
  ALTER COLUMN "serie" DROP NOT NULL,
  ALTER COLUMN "serie" TYPE VARCHAR(20),
  ALTER COLUMN "numero" TYPE VARCHAR(100);

CREATE UNIQUE INDEX "guia_remision_billing_document_id_key"
ON "guia_remision"("billing_document_id");

CREATE TABLE "billing_despatch_guide_outbox" (
  "id" UUID NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "guia_remision_id" BIGINT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "idempotency_key" VARCHAR(140) NOT NULL,
  "status" "BillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 20,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_despatch_guide_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_despatch_guide_outbox_idempotency_key_key"
ON "billing_despatch_guide_outbox"("idempotency_key");
CREATE UNIQUE INDEX "billing_despatch_guide_outbox_guia_remision_id_environment_key"
ON "billing_despatch_guide_outbox"("guia_remision_id", "environment");
CREATE INDEX "billing_despatch_guide_outbox_status_next_attempt_at_idx"
ON "billing_despatch_guide_outbox"("status", "next_attempt_at");
CREATE INDEX "billing_despatch_guide_outbox_empresa_id_status_idx"
ON "billing_despatch_guide_outbox"("empresa_id", "status");

ALTER TABLE "billing_despatch_guide_outbox"
ADD CONSTRAINT "billing_despatch_guide_outbox_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_despatch_guide_outbox"
ADD CONSTRAINT "billing_despatch_guide_outbox_guia_remision_id_fkey"
FOREIGN KEY ("guia_remision_id") REFERENCES "guia_remision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
