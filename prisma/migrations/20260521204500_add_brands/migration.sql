CREATE TABLE "marca" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "nombre" VARCHAR(120) NOT NULL,
  "nombre_key" VARCHAR(140) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "marca_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marca_empresa_id_nombre_key_key" ON "marca"("empresa_id", "nombre_key");
CREATE INDEX "marca_empresa_id_idx" ON "marca"("empresa_id");
CREATE INDEX "marca_deleted_at_idx" ON "marca"("deleted_at");

ALTER TABLE "marca"
ADD CONSTRAINT "marca_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
