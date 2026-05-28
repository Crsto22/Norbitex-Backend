-- Step 1: Add public_id column as nullable (to allow backfill for existing rows)
ALTER TABLE "producto" ADD COLUMN "public_id" VARCHAR(30);

-- Step 2: Create unique index
-- Using partial index to allow NULLs until backfill is complete
CREATE UNIQUE INDEX "producto_public_id_key" ON "producto"("public_id") WHERE "public_id" IS NOT NULL;

-- After backfill, run manually:
-- ALTER TABLE "producto" ALTER COLUMN "public_id" SET NOT NULL;
-- Then replace the partial index with a full unique index:
-- DROP INDEX "producto_public_id_key";
-- CREATE UNIQUE INDEX "producto_public_id_key" ON "producto"("public_id");