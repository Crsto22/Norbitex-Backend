-- CreateTable
CREATE TABLE "registro_pendiente" (
    "id" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "apellido" VARCHAR(100),
    "email" VARCHAR(180) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "registro_pendiente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registro_pendiente_email_key" ON "registro_pendiente"("email");

-- CreateIndex
CREATE INDEX "registro_pendiente_expires_at_idx" ON "registro_pendiente"("expires_at");
