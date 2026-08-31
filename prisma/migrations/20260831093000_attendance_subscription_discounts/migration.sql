ALTER TABLE "tarifa_asistencia"
  ADD COLUMN IF NOT EXISTS "descuento_anual_porcentaje" numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "pago_suscripcion"
  ADD COLUMN IF NOT EXISTS "descuento_manual_tipo" varchar(10),
  ADD COLUMN IF NOT EXISTS "descuento_manual_valor" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "monto_descuento_manual" numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "suscripcion_asistencia"
  ADD COLUMN IF NOT EXISTS "descuento_porcentaje" numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monto_descuento" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "descuento_manual_tipo" varchar(10),
  ADD COLUMN IF NOT EXISTS "descuento_manual_valor" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "monto_descuento_manual" numeric(12,2) NOT NULL DEFAULT 0;
