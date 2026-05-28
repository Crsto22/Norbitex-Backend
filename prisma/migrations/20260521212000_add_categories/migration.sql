CREATE TABLE "categoria" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "nombre" VARCHAR(120) NOT NULL,
  "nombre_key" VARCHAR(140) NOT NULL,
  "descripcion" VARCHAR(500),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categoria_empresa_id_nombre_key_key" ON "categoria"("empresa_id", "nombre_key");
CREATE INDEX "categoria_empresa_id_idx" ON "categoria"("empresa_id");
CREATE INDEX "categoria_deleted_at_idx" ON "categoria"("deleted_at");

ALTER TABLE "categoria"
ADD CONSTRAINT "categoria_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
