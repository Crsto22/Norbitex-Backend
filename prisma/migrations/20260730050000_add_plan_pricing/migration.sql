CREATE TABLE "tarifa_plan" (
  "plan_codigo" "PlanCodigo" NOT NULL,
  "precio_mensual" DECIMAL(12, 2) NOT NULL,
  "descuento_anual_porcentaje" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "actualizado_por_id" BIGINT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifa_plan_pkey" PRIMARY KEY ("plan_codigo")
);

INSERT INTO "tarifa_plan" (
  "plan_codigo",
  "precio_mensual",
  "descuento_anual_porcentaje"
) VALUES
  ('prueba', 0.00, 0.00),
  ('emprendedor', 49.00, 0.00),
  ('crecimiento', 99.00, 0.00),
  ('empresarial', 179.00, 0.00);

CREATE INDEX "tarifa_plan_actualizado_por_id_idx"
ON "tarifa_plan"("actualizado_por_id");

ALTER TABLE "tarifa_plan"
ADD CONSTRAINT "tarifa_plan_actualizado_por_id_fkey"
FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pago_suscripcion"
ADD COLUMN "monto_lista" DECIMAL(12, 2),
ADD COLUMN "descuento_porcentaje" DECIMAL(5, 2) NOT NULL DEFAULT 0,
ADD COLUMN "monto_descuento" DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE "pago_suscripcion"
SET "monto_lista" = "monto_total";

ALTER TABLE "pago_suscripcion"
ALTER COLUMN "monto_lista" SET NOT NULL;
