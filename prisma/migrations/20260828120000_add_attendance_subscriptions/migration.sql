CREATE TYPE "SuscripcionAsistenciaPeriodo" AS ENUM ('mensual', 'anual');
CREATE TYPE "SuscripcionAsistenciaEstado" AS ENUM ('activa', 'cancelada');

CREATE TABLE "suscripcion_asistencia" (
  "id" BIGSERIAL PRIMARY KEY,
  "request_id" UUID NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "registrado_por_id" BIGINT NOT NULL,
  "anulado_por_id" BIGINT,
  "trabajadores_limite" BIGINT NOT NULL,
  "puntos_qr_limite" BIGINT NOT NULL,
  "precio_trabajador_snapshot" DECIMAL(12,2) NOT NULL,
  "precio_punto_qr_snapshot" DECIMAL(12,2) NOT NULL,
  "periodo" "SuscripcionAsistenciaPeriodo" NOT NULL,
  "monto_mensual" DECIMAL(12,2) NOT NULL,
  "monto_total" DECIMAL(12,2) NOT NULL,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "incluye_igv" BOOLEAN NOT NULL DEFAULT true,
  "metodo_pago" "PagoSuscripcionMetodo" NOT NULL,
  "metodo_pago_otro" VARCHAR(80),
  "estado" "SuscripcionAsistenciaEstado" NOT NULL DEFAULT 'activa',
  "vigencia_inicio_at" TIMESTAMPTZ(6) NOT NULL,
  "vigencia_fin_at" TIMESTAMPTZ(6) NOT NULL,
  "limite_anterior_trabajadores" BIGINT NOT NULL,
  "limite_anterior_puntos_qr" BIGINT NOT NULL,
  "asistencia_anterior_activa" BOOLEAN NOT NULL,
  "asistencia_anterior_inicio_at" TIMESTAMPTZ(6),
  "asistencia_anterior_fin_at" TIMESTAMPTZ(6),
  "motivo_anulacion" VARCHAR(300),
  "anulado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "suscripcion_asistencia_request_id_key" ON "suscripcion_asistencia"("request_id");
CREATE INDEX "suscripcion_asistencia_empresa_id_created_at_idx" ON "suscripcion_asistencia"("empresa_id", "created_at");
CREATE INDEX "suscripcion_asistencia_estado_created_at_idx" ON "suscripcion_asistencia"("estado", "created_at");
CREATE INDEX "suscripcion_asistencia_metodo_pago_created_at_idx" ON "suscripcion_asistencia"("metodo_pago", "created_at");
CREATE INDEX "suscripcion_asistencia_registrado_por_id_created_at_idx" ON "suscripcion_asistencia"("registrado_por_id", "created_at");

ALTER TABLE "suscripcion_asistencia"
  ADD CONSTRAINT "suscripcion_asistencia_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suscripcion_asistencia"
  ADD CONSTRAINT "suscripcion_asistencia_registrado_por_id_fkey"
  FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suscripcion_asistencia"
  ADD CONSTRAINT "suscripcion_asistencia_anulado_por_id_fkey"
  FOREIGN KEY ("anulado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
