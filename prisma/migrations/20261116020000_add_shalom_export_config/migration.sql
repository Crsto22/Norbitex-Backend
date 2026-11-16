-- Ajustes de exportacion del formato masivo de Shalom
CREATE TABLE "empresa_shalom_export_config" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "origen" VARCHAR(300),
  "modo" VARCHAR(20) NOT NULL DEFAULT 'ninguno',
  "mercaderia" VARCHAR(30),
  "alto" DECIMAL(8, 3),
  "ancho" DECIMAL(8, 3),
  "largo" DECIMAL(8, 3),
  "peso" DECIMAL(8, 3),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "empresa_shalom_export_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_shalom_export_config_empresa_id_key"
  ON "empresa_shalom_export_config"("empresa_id");

ALTER TABLE "empresa_shalom_export_config"
  ADD CONSTRAINT "empresa_shalom_export_config_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
