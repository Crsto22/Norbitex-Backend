CREATE TYPE "PagoSuscripcionMetodo" AS ENUM (
  'yape',
  'plin',
  'transferencia',
  'deposito',
  'efectivo',
  'otro'
);

CREATE TYPE "PagoSuscripcionEstado" AS ENUM ('pagado', 'anulado');

CREATE TABLE "pago_suscripcion" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "registrado_por_id" BIGINT NOT NULL,
  "anulado_por_id" BIGINT,
  "plan_codigo" "PlanCodigo" NOT NULL,
  "meses" INTEGER NOT NULL,
  "precio_mensual" DECIMAL(12, 2) NOT NULL,
  "monto_total" DECIMAL(12, 2) NOT NULL,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "incluye_igv" BOOLEAN NOT NULL DEFAULT true,
  "metodo_pago" "PagoSuscripcionMetodo" NOT NULL,
  "metodo_pago_otro" VARCHAR(80),
  "estado" "PagoSuscripcionEstado" NOT NULL DEFAULT 'pagado',
  "plan_anterior_codigo" "PlanCodigo" NOT NULL,
  "plan_anterior_inicio_at" TIMESTAMPTZ(6) NOT NULL,
  "plan_anterior_fin_at" TIMESTAMPTZ(6),
  "vigencia_inicio_at" TIMESTAMPTZ(6) NOT NULL,
  "vigencia_fin_at" TIMESTAMPTZ(6) NOT NULL,
  "plan_resultante_inicio_at" TIMESTAMPTZ(6) NOT NULL,
  "plan_resultante_fin_at" TIMESTAMPTZ(6) NOT NULL,
  "motivo_anulacion" VARCHAR(300),
  "anulado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pago_suscripcion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pago_suscripcion_request_id_key"
ON "pago_suscripcion"("request_id");

CREATE INDEX "pago_suscripcion_empresa_id_created_at_idx"
ON "pago_suscripcion"("empresa_id", "created_at");

CREATE INDEX "pago_suscripcion_estado_created_at_idx"
ON "pago_suscripcion"("estado", "created_at");

CREATE INDEX "pago_suscripcion_plan_codigo_created_at_idx"
ON "pago_suscripcion"("plan_codigo", "created_at");

CREATE INDEX "pago_suscripcion_metodo_pago_created_at_idx"
ON "pago_suscripcion"("metodo_pago", "created_at");

CREATE INDEX "pago_suscripcion_registrado_por_id_created_at_idx"
ON "pago_suscripcion"("registrado_por_id", "created_at");

ALTER TABLE "pago_suscripcion"
ADD CONSTRAINT "pago_suscripcion_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pago_suscripcion"
ADD CONSTRAINT "pago_suscripcion_registrado_por_id_fkey"
FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pago_suscripcion"
ADD CONSTRAINT "pago_suscripcion_anulado_por_id_fkey"
FOREIGN KEY ("anulado_por_id") REFERENCES "usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
