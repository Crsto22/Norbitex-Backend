CREATE TYPE "PuntoQrAsistenciaEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "punto_qr_asistencia" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "codigo" VARCHAR(80) NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "precision_metros" DOUBLE PRECISION,
    "radio_metros" INTEGER NOT NULL DEFAULT 100,
    "estado" "PuntoQrAsistenciaEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "punto_qr_asistencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "punto_qr_asistencia_codigo_key" ON "punto_qr_asistencia"("codigo");
CREATE UNIQUE INDEX "punto_qr_asistencia_empresa_id_nombre_key" ON "punto_qr_asistencia"("empresa_id", "nombre");
CREATE INDEX "punto_qr_asistencia_empresa_id_idx" ON "punto_qr_asistencia"("empresa_id");
CREATE INDEX "punto_qr_asistencia_sucursal_id_idx" ON "punto_qr_asistencia"("sucursal_id");
CREATE INDEX "punto_qr_asistencia_empresa_id_estado_idx" ON "punto_qr_asistencia"("empresa_id", "estado");
CREATE INDEX "punto_qr_asistencia_empresa_id_created_at_idx" ON "punto_qr_asistencia"("empresa_id", "created_at");

ALTER TABLE "punto_qr_asistencia" ADD CONSTRAINT "punto_qr_asistencia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "punto_qr_asistencia" ADD CONSTRAINT "punto_qr_asistencia_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
