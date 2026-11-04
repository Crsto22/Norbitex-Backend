ALTER TYPE "BillingOutboxOperation" ADD VALUE IF NOT EXISTS 'VOID';

ALTER TABLE "venta"
  ADD COLUMN "billing_void_request_id" UUID,
  ADD COLUMN "billing_void_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "billing_void_retry_sequence" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "venta_billing_void_request_id_key"
  ON "venta"("billing_void_request_id");

CREATE INDEX "venta_billing_void_updated_at_idx"
  ON "venta"("billing_void_updated_at");
