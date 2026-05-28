-- CreateEnum
CREATE TYPE "MetodoPagoTipo" AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'billetera_digital', 'qr', 'yape', 'plin');

-- CreateEnum
CREATE TYPE "MetodoPagoEstado" AS ENUM ('activo', 'inactivo');

-- CreateTable
CREATE TABLE "metodo_pago" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "tipo" "MetodoPagoTipo" NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "nombre_key" VARCHAR(140) NOT NULL,
    "descripcion" VARCHAR(500),
    "estado" "MetodoPagoEstado" NOT NULL DEFAULT 'activo',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metodo_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metodo_pago_empresa_id_idx" ON "metodo_pago"("empresa_id");

-- CreateIndex
CREATE INDEX "metodo_pago_deleted_at_idx" ON "metodo_pago"("deleted_at");

-- CreateIndex
CREATE INDEX "metodo_pago_estado_idx" ON "metodo_pago"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pago_empresa_id_nombre_key_key" ON "metodo_pago"("empresa_id", "nombre_key");

-- AddForeignKey
ALTER TABLE "metodo_pago" ADD CONSTRAINT "metodo_pago_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
