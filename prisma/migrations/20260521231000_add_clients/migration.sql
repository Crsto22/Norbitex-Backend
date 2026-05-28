CREATE TYPE "ClienteTipoDocumento" AS ENUM ('dni', 'ruc', 'sin_documento');

CREATE TYPE "ClienteEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "cliente" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "tipo_documento" "ClienteTipoDocumento" NOT NULL,
    "numero_documento" VARCHAR(20),
    "nombre" VARCHAR(150),
    "razon_social" VARCHAR(200),
    "telefono" VARCHAR(30),
    "email" VARCHAR(150),
    "direccion" VARCHAR(255),
    "ubigeo" VARCHAR(6),
    "distrito" VARCHAR(80),
    "estado" "ClienteEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cliente_empresa_documento_unique" ON "cliente"("empresa_id", "tipo_documento", "numero_documento") WHERE "numero_documento" IS NOT NULL;
CREATE INDEX "cliente_empresa_id_idx" ON "cliente"("empresa_id");
CREATE INDEX "cliente_tipo_documento_idx" ON "cliente"("tipo_documento");
CREATE INDEX "cliente_numero_documento_idx" ON "cliente"("numero_documento");
CREATE INDEX "cliente_estado_idx" ON "cliente"("estado");

ALTER TABLE "cliente" ADD CONSTRAINT "cliente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
