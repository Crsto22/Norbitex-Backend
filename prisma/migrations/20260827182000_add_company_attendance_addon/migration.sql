ALTER TABLE "empresa"
  ADD COLUMN IF NOT EXISTS "asistencias_activa" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "asistencias_trabajadores_limite" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "asistencias_puntos_qr_limite" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "asistencias_precio_trabajador" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "asistencias_precio_punto_qr" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "asistencias_precio_mensual" numeric(12,2) NOT NULL DEFAULT 0;
