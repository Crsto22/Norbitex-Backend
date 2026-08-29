ALTER TABLE "suscripcion_asistencia"
  ADD COLUMN "afiliado_id" BIGINT,
  ADD COLUMN "afiliado_codigo" VARCHAR(30),
  ADD COLUMN "descuento_afiliado_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "monto_descuento_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "base_comision_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "comision_afiliado_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "monto_comision_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "comision_afiliado"
  ALTER COLUMN "pago_suscripcion_id" DROP NOT NULL,
  ADD COLUMN "suscripcion_asistencia_id" BIGINT;

CREATE INDEX "suscripcion_asistencia_afiliado_id_created_at_idx"
  ON "suscripcion_asistencia"("afiliado_id", "created_at");

CREATE UNIQUE INDEX "comision_afiliado_suscripcion_asistencia_id_tipo_key"
  ON "comision_afiliado"("suscripcion_asistencia_id", "tipo");

CREATE INDEX "comision_afiliado_suscripcion_asistencia_id_idx"
  ON "comision_afiliado"("suscripcion_asistencia_id");

ALTER TABLE "suscripcion_asistencia"
  ADD CONSTRAINT "suscripcion_asistencia_afiliado_id_fkey"
  FOREIGN KEY ("afiliado_id") REFERENCES "afiliado"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "comision_afiliado"
  ADD CONSTRAINT "comision_afiliado_suscripcion_asistencia_id_fkey"
  FOREIGN KEY ("suscripcion_asistencia_id") REFERENCES "suscripcion_asistencia"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
