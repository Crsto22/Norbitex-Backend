CREATE TABLE IF NOT EXISTS "empresa_envio_preview_config" (
  "empresa_id" BIGINT NOT NULL,
  "titulo" VARCHAR(60),
  "descripcion" VARCHAR(120),
  "color_primario" VARCHAR(7) NOT NULL DEFAULT '#101D69',
  "texto_central" VARCHAR(40),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "empresa_envio_preview_config_pkey" PRIMARY KEY ("empresa_id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'empresa_envio_preview_config_empresa_id_fkey'
  ) THEN
    ALTER TABLE "empresa_envio_preview_config"
      ADD CONSTRAINT "empresa_envio_preview_config_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
