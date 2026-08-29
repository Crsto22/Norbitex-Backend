ALTER TABLE "empleado"
ADD COLUMN "pin_hash" TEXT,
ADD COLUMN "activation_token_hash" VARCHAR(64),
ADD COLUMN "activation_token_expires_at" TIMESTAMPTZ(6),
ADD COLUMN "activation_token_used_at" TIMESTAMPTZ(6),
ADD COLUMN "activated_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "empleado_activation_token_hash_key" ON "empleado"("activation_token_hash");
CREATE INDEX "empleado_activation_token_expires_at_idx" ON "empleado"("activation_token_expires_at");
