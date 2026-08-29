CREATE TABLE IF NOT EXISTS "tarifa_asistencia" (
  "id" integer NOT NULL DEFAULT 1,
  "precio_trabajador" numeric(12,2) NOT NULL DEFAULT 2.00,
  "precio_punto_qr" numeric(12,2) NOT NULL DEFAULT 10.00,
  "actualizado_por_id" bigint,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifa_asistencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tarifa_asistencia_actualizado_por_id_fkey"
    FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "tarifa_asistencia" ("id", "precio_trabajador", "precio_punto_qr")
VALUES (1, 2.00, 10.00)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "empresa"
  ADD COLUMN IF NOT EXISTS "asistencias_inicio_at" timestamptz(6),
  ADD COLUMN IF NOT EXISTS "asistencias_fin_at" timestamptz(6),
  DROP COLUMN IF EXISTS "asistencias_precio_trabajador",
  DROP COLUMN IF EXISTS "asistencias_precio_punto_qr",
  DROP COLUMN IF EXISTS "asistencias_precio_mensual";
