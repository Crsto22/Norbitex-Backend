ALTER TABLE "nota_credito"
  ALTER COLUMN "numero" DROP NOT NULL,
  ALTER COLUMN "correlativo" DROP NOT NULL,
  ADD COLUMN "billing_document_id" UUID,
  ADD COLUMN "billing_environment" "BillingEnvironment",
  ADD COLUMN "billing_status" "BillingDocumentStatus",
  ADD COLUMN "billing_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_last_error" VARCHAR(1000),
  ADD COLUMN "billing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "commercial_effects_applied" BOOLEAN NOT NULL DEFAULT false;

UPDATE "nota_credito"
SET "commercial_effects_applied" = true
WHERE "stock_devuelto" = true;

CREATE UNIQUE INDEX "nota_credito_billing_document_id_key"
  ON "nota_credito"("billing_document_id");
CREATE INDEX "nota_credito_billing_updated_at_idx"
  ON "nota_credito"("billing_updated_at");

CREATE TABLE "billing_credit_note_outbox" (
  "id" UUID PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL,
  "nota_credito_id" BIGINT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "status" "BillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 12,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_credit_note_outbox_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_credit_note_outbox_nota_credito_id_fkey"
    FOREIGN KEY ("nota_credito_id") REFERENCES "nota_credito"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_credit_note_outbox_idempotency_key_key"
  ON "billing_credit_note_outbox"("idempotency_key");
CREATE UNIQUE INDEX "billing_credit_note_outbox_nota_credito_id_environment_key"
  ON "billing_credit_note_outbox"("nota_credito_id", "environment");
CREATE INDEX "billing_credit_note_outbox_status_next_attempt_at_idx"
  ON "billing_credit_note_outbox"("status", "next_attempt_at");
CREATE INDEX "billing_credit_note_outbox_empresa_id_status_idx"
  ON "billing_credit_note_outbox"("empresa_id", "status");
