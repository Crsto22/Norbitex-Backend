CREATE TABLE "color" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "nombre" VARCHAR(80) NOT NULL,
  "nombre_key" VARCHAR(100) NOT NULL,
  "hex" VARCHAR(7) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "color_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "color_empresa_id_nombre_key_key" ON "color"("empresa_id", "nombre_key");
CREATE INDEX "color_empresa_id_idx" ON "color"("empresa_id");
CREATE INDEX "color_deleted_at_idx" ON "color"("deleted_at");

ALTER TABLE "color"
ADD CONSTRAINT "color_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
