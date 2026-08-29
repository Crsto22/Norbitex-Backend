CREATE TYPE "MarcajeAsistenciaTipo" AS ENUM ('entrada', 'salida');
CREATE TYPE "MarcajeAsistenciaMetodo" AS ENUM ('qr');
CREATE TYPE "MarcajeAsistenciaEstado" AS ENUM ('valido', 'observado', 'anulado');

CREATE TABLE "marcaje_asistencia" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "empleado_id" BIGINT NOT NULL,
    "turno_id" BIGINT,
    "sucursal_id" BIGINT,
    "punto_qr_id" BIGINT,
    "tipo" "MarcajeAsistenciaTipo" NOT NULL,
    "metodo" "MarcajeAsistenciaMetodo" NOT NULL DEFAULT 'qr',
    "estado" "MarcajeAsistenciaEstado" NOT NULL DEFAULT 'valido',
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "precision_metros" DOUBLE PRECISION,
    "distancia_metros" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marcaje_asistencia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marcaje_asistencia_empresa_id_fecha_hora_idx" ON "marcaje_asistencia"("empresa_id", "fecha_hora");
CREATE INDEX "marcaje_asistencia_empresa_id_empleado_id_fecha_hora_idx" ON "marcaje_asistencia"("empresa_id", "empleado_id", "fecha_hora");
CREATE INDEX "marcaje_asistencia_empresa_id_sucursal_id_fecha_hora_idx" ON "marcaje_asistencia"("empresa_id", "sucursal_id", "fecha_hora");
CREATE INDEX "marcaje_asistencia_empresa_id_turno_id_fecha_hora_idx" ON "marcaje_asistencia"("empresa_id", "turno_id", "fecha_hora");
CREATE INDEX "marcaje_asistencia_punto_qr_id_idx" ON "marcaje_asistencia"("punto_qr_id");

ALTER TABLE "marcaje_asistencia" ADD CONSTRAINT "marcaje_asistencia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marcaje_asistencia" ADD CONSTRAINT "marcaje_asistencia_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marcaje_asistencia" ADD CONSTRAINT "marcaje_asistencia_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marcaje_asistencia" ADD CONSTRAINT "marcaje_asistencia_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marcaje_asistencia" ADD CONSTRAINT "marcaje_asistencia_punto_qr_id_fkey" FOREIGN KEY ("punto_qr_id") REFERENCES "punto_qr_asistencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
