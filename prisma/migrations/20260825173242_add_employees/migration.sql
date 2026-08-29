CREATE TYPE "EmpleadoTipoDocumento" AS ENUM ('dni', 'carnet_extranjeria', 'otro');
CREATE TYPE "EmpleadoEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "empleado" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "tipo_documento" "EmpleadoTipoDocumento" NOT NULL,
    "numero_documento" VARCHAR(30) NOT NULL,
    "nombres" VARCHAR(150) NOT NULL,
    "apellido_paterno" VARCHAR(100),
    "apellido_materno" VARCHAR(100),
    "email" VARCHAR(180) NOT NULL,
    "telefono" VARCHAR(30) NOT NULL,
    "estado" "EmpleadoEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "empleado_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empleado_email_key" ON "empleado"("email");
CREATE UNIQUE INDEX "empleado_empresa_id_tipo_documento_numero_documento_key" ON "empleado"("empresa_id", "tipo_documento", "numero_documento");
CREATE INDEX "empleado_empresa_id_idx" ON "empleado"("empresa_id");
CREATE INDEX "empleado_empresa_id_estado_idx" ON "empleado"("empresa_id", "estado");
CREATE INDEX "empleado_empresa_id_created_at_idx" ON "empleado"("empresa_id", "created_at");

ALTER TABLE "empleado" ADD CONSTRAINT "empleado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
