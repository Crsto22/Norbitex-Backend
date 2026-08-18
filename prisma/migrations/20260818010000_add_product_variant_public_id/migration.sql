ALTER TABLE "producto_variante"
ADD COLUMN "public_id" VARCHAR(36);

UPDATE "producto_variante"
SET "public_id" = gen_random_uuid()::text
WHERE "public_id" IS NULL;

ALTER TABLE "producto_variante"
ALTER COLUMN "public_id" SET NOT NULL;

ALTER TABLE "producto_variante"
ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX "producto_variante_public_id_key"
ON "producto_variante"("public_id");

CREATE INDEX "producto_variante_public_id_idx"
ON "producto_variante"("public_id");
