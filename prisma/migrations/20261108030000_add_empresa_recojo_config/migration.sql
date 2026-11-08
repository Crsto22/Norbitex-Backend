CREATE TABLE "empresa_recojo_config" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "dias_semana" INTEGER[] NOT NULL,
  "hora_corte" VARCHAR(5) NOT NULL,
  "anticipacion_dias" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_recojo_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_recojo_config_empresa_id_key"
  ON "empresa_recojo_config"("empresa_id");

ALTER TABLE "empresa_recojo_config"
  ADD CONSTRAINT "empresa_recojo_config_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
