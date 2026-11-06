CREATE TYPE "VentaEnvioEstado" AS ENUM ('pendiente', 'recibido');

CREATE TYPE "VentaEnvioAgencia" AS ENUM ('SHALOM', 'OLVA');

CREATE TABLE "venta_envio" (
    "id" BIGSERIAL NOT NULL,
    "venta_id" BIGINT NOT NULL,
    "codigo_publico" VARCHAR(12) NOT NULL,
    "estado" "VentaEnvioEstado" NOT NULL DEFAULT 'pendiente',
    "nombre_completo" VARCHAR(150),
    "dni" VARCHAR(8),
    "celular" VARCHAR(9),
    "agencia" "VentaEnvioAgencia",
    "recibido_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "venta_envio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venta_envio_venta_id_key" ON "venta_envio"("venta_id");
CREATE UNIQUE INDEX "venta_envio_codigo_publico_key" ON "venta_envio"("codigo_publico");
CREATE INDEX "venta_envio_estado_idx" ON "venta_envio"("estado");
CREATE INDEX "venta_envio_created_at_idx" ON "venta_envio"("created_at");

ALTER TABLE "venta_envio"
ADD CONSTRAINT "venta_envio_venta_id_fkey"
FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
