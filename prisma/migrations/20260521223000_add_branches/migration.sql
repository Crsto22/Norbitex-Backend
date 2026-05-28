CREATE TYPE "SucursalTipo" AS ENUM ('tienda', 'almacen');

CREATE TYPE "SucursalEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "sucursal" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "nombre_key" VARCHAR(140) NOT NULL,
    "tipo" "SucursalTipo" NOT NULL,
    "ubigeo" VARCHAR(6) NOT NULL,
    "distrito" VARCHAR(80) NOT NULL,
    "direccion" VARCHAR(255) NOT NULL,
    "codigo_establecimiento_sunat" VARCHAR(10),
    "estado" "SucursalEstado" NOT NULL DEFAULT 'activo',
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sucursal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sucursal_empresa_id_nombre_key_key" ON "sucursal"("empresa_id", "nombre_key");
CREATE UNIQUE INDEX "sucursal_empresa_principal_unique" ON "sucursal"("empresa_id") WHERE "es_principal" = true;
CREATE INDEX "sucursal_empresa_id_idx" ON "sucursal"("empresa_id");
CREATE INDEX "sucursal_tipo_idx" ON "sucursal"("tipo");
CREATE INDEX "sucursal_ubigeo_idx" ON "sucursal"("ubigeo");
CREATE INDEX "sucursal_estado_idx" ON "sucursal"("estado");

ALTER TABLE "sucursal" ADD CONSTRAINT "sucursal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
