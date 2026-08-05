CREATE TABLE "login_intento" (
  "id" BIGSERIAL NOT NULL,
  "clave_hash" VARCHAR(64) NOT NULL,
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "ultimo_intento_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_intento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_intento_clave_hash_key"
  ON "login_intento"("clave_hash");
