CREATE TABLE "empresa_envio_config" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "metodo" VARCHAR(50) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_envio_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_envio_config_empresa_id_metodo_key"
  ON "empresa_envio_config"("empresa_id", "metodo");

ALTER TABLE "empresa_envio_config"
  ADD CONSTRAINT "empresa_envio_config_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
