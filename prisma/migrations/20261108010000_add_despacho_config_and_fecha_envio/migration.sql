CREATE TABLE "empresa_despacho_config" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "dias_semana" INTEGER[] NOT NULL,
  "hora_corte" VARCHAR(5) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_despacho_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_despacho_config_empresa_id_key"
  ON "empresa_despacho_config"("empresa_id");

ALTER TABLE "empresa_despacho_config"
  ADD CONSTRAINT "empresa_despacho_config_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venta_envio"
  ADD COLUMN "fecha_envio" DATE;
