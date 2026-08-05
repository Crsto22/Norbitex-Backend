-- AlterTable
ALTER TABLE "empresa" ADD COLUMN "dni" VARCHAR(8);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_dni_key" ON "empresa"("dni");
