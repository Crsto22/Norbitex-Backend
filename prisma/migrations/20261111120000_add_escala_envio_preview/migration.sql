ALTER TABLE "empresa_envio_preview_config"
  ADD COLUMN IF NOT EXISTS "escala_contenido" INTEGER NOT NULL DEFAULT 100;
