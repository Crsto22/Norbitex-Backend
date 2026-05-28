CREATE TABLE "talla" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "nombre" VARCHAR(80) NOT NULL,
  "nombre_key" VARCHAR(100) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "talla_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "talla_empresa_id_nombre_key_key" ON "talla"("empresa_id", "nombre_key");
CREATE INDEX "talla_empresa_id_idx" ON "talla"("empresa_id");
CREATE INDEX "talla_deleted_at_idx" ON "talla"("deleted_at");

ALTER TABLE "talla"
ADD CONSTRAINT "talla_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
