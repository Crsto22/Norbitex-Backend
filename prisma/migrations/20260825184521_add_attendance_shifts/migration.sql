CREATE TYPE "TurnoEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "turno" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "hora_entrada" VARCHAR(5) NOT NULL,
    "hora_salida" VARCHAR(5) NOT NULL,
    "dias_laborables" INTEGER[] NOT NULL,
    "estado" "TurnoEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "turno_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "empleado" ADD COLUMN "turno_id" BIGINT;

CREATE UNIQUE INDEX "turno_empresa_id_nombre_key" ON "turno"("empresa_id", "nombre");
CREATE INDEX "turno_empresa_id_idx" ON "turno"("empresa_id");
CREATE INDEX "turno_empresa_id_estado_idx" ON "turno"("empresa_id", "estado");
CREATE INDEX "turno_empresa_id_created_at_idx" ON "turno"("empresa_id", "created_at");
CREATE INDEX "empleado_turno_id_idx" ON "empleado"("turno_id");

ALTER TABLE "turno" ADD CONSTRAINT "turno_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "empleado" ADD CONSTRAINT "empleado_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
