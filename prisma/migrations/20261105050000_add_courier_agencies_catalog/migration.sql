CREATE TYPE "AgenciaCourierProveedor" AS ENUM ('SHALOM', 'OLVA');
CREATE TYPE "AgenciaCourierSincronizacionEstado" AS ENUM ('procesando', 'completada', 'fallida');

CREATE TABLE "agencia_courier" (
    "id" BIGSERIAL NOT NULL,
    "courier" "AgenciaCourierProveedor" NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "nombre" VARCHAR(300) NOT NULL,
    "tipo_sede" VARCHAR(100),
    "direccion" TEXT,
    "referencia" TEXT,
    "telefono" VARCHAR(100),
    "departamento" VARCHAR(100),
    "provincia" VARCHAR(100),
    "distrito" VARCHAR(100),
    "ubigeo" VARCHAR(12),
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "horario" JSONB,
    "servicios" JSONB,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fuente_actualizada_at" TIMESTAMPTZ(6),
    "sincronizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "agencia_courier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agencia_courier_sincronizacion" (
    "id" BIGSERIAL NOT NULL,
    "courier" "AgenciaCourierProveedor" NOT NULL,
    "estado" "AgenciaCourierSincronizacionEstado" NOT NULL DEFAULT 'procesando',
    "iniciada_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizada_at" TIMESTAMPTZ(6),
    "total_recibidas" INTEGER NOT NULL DEFAULT 0,
    "creadas" INTEGER NOT NULL DEFAULT 0,
    "actualizadas" INTEGER NOT NULL DEFAULT 0,
    "desactivadas" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "agencia_courier_sincronizacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agencia_courier_courier_external_id_key" ON "agencia_courier"("courier", "external_id");
CREATE INDEX "agencia_courier_courier_activo_idx" ON "agencia_courier"("courier", "activo");
CREATE INDEX "agencia_courier_courier_ubigeo_idx" ON "agencia_courier"("courier", "ubigeo");
CREATE INDEX "agencia_courier_courier_departamento_provincia_distrito_idx" ON "agencia_courier"("courier", "departamento", "provincia", "distrito");
CREATE INDEX "agencia_courier_nombre_idx" ON "agencia_courier"("nombre");
CREATE INDEX "agencia_courier_sincronizacion_courier_iniciada_at_idx" ON "agencia_courier_sincronizacion"("courier", "iniciada_at");

ALTER TABLE "venta_envio"
ADD COLUMN "agencia_external_id" VARCHAR(100),
ADD COLUMN "agencia_nombre" VARCHAR(300),
ADD COLUMN "agencia_direccion" TEXT,
ADD COLUMN "agencia_departamento" VARCHAR(100),
ADD COLUMN "agencia_provincia" VARCHAR(100),
ADD COLUMN "agencia_distrito" VARCHAR(100),
ADD COLUMN "agencia_ubigeo" VARCHAR(12),
ADD COLUMN "agencia_latitud" DOUBLE PRECISION,
ADD COLUMN "agencia_longitud" DOUBLE PRECISION;
