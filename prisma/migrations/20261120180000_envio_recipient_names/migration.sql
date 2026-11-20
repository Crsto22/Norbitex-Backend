-- Separa nombres y apellidos del destinatario para el registro en Shalom.
ALTER TABLE "venta_envio"
  ADD COLUMN IF NOT EXISTS "nombres" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "apellido_paterno" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "apellido_materno" VARCHAR(100);
