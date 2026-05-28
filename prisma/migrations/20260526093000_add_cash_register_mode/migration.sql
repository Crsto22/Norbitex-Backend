-- CreateEnum
CREATE TYPE "CajaSesionEstado" AS ENUM ('abierta', 'cerrada');

-- CreateEnum
CREATE TYPE "CajaMovimientoTipo" AS ENUM ('apertura', 'venta', 'ingreso', 'retiro', 'anulacion_venta');

-- AlterTable
ALTER TABLE "sucursal" ADD COLUMN "modo_caja_habilitado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "venta" ADD COLUMN "caja_sesion_id" BIGINT;

-- CreateTable
CREATE TABLE "caja_sesion" (
    "id" BIGSERIAL NOT NULL,
    "public_id" VARCHAR(30) NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "estado" "CajaSesionEstado" NOT NULL DEFAULT 'abierta',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "closed_at" TIMESTAMPTZ(6),
    "monto_inicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_esperado" DECIMAL(12,2),
    "monto_declarado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "observaciones_apertura" VARCHAR(500),
    "observaciones_cierre" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "caja_sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caja_movimiento" (
    "id" BIGSERIAL NOT NULL,
    "public_id" VARCHAR(30) NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "caja_sesion_id" BIGINT NOT NULL,
    "venta_id" BIGINT,
    "venta_pago_id" BIGINT,
    "metodo_pago_id" BIGINT,
    "tipo" "CajaMovimientoTipo" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" VARCHAR(500),
    "referencia" VARCHAR(200),
    "creado_por_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "caja_movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "caja_sesion_public_id_key" ON "caja_sesion"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "caja_movimiento_public_id_key" ON "caja_movimiento"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "caja_sesion_open_unique_idx" ON "caja_sesion"("empresa_id", "sucursal_id", "usuario_id") WHERE "estado" = 'abierta';

-- CreateIndex
CREATE INDEX "caja_sesion_empresa_id_idx" ON "caja_sesion"("empresa_id");

-- CreateIndex
CREATE INDEX "caja_sesion_sucursal_id_idx" ON "caja_sesion"("sucursal_id");

-- CreateIndex
CREATE INDEX "caja_sesion_usuario_id_idx" ON "caja_sesion"("usuario_id");

-- CreateIndex
CREATE INDEX "caja_sesion_estado_idx" ON "caja_sesion"("estado");

-- CreateIndex
CREATE INDEX "caja_sesion_opened_at_idx" ON "caja_sesion"("opened_at");

-- CreateIndex
CREATE INDEX "caja_movimiento_empresa_id_idx" ON "caja_movimiento"("empresa_id");

-- CreateIndex
CREATE INDEX "caja_movimiento_caja_sesion_id_idx" ON "caja_movimiento"("caja_sesion_id");

-- CreateIndex
CREATE INDEX "caja_movimiento_venta_id_idx" ON "caja_movimiento"("venta_id");

-- CreateIndex
CREATE INDEX "caja_movimiento_venta_pago_id_idx" ON "caja_movimiento"("venta_pago_id");

-- CreateIndex
CREATE INDEX "caja_movimiento_metodo_pago_id_idx" ON "caja_movimiento"("metodo_pago_id");

-- CreateIndex
CREATE INDEX "caja_movimiento_tipo_idx" ON "caja_movimiento"("tipo");

-- CreateIndex
CREATE INDEX "caja_movimiento_created_at_idx" ON "caja_movimiento"("created_at");

-- CreateIndex
CREATE INDEX "venta_caja_sesion_id_idx" ON "venta"("caja_sesion_id");

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_caja_sesion_id_fkey" FOREIGN KEY ("caja_sesion_id") REFERENCES "caja_sesion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesion" ADD CONSTRAINT "caja_sesion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesion" ADD CONSTRAINT "caja_sesion_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesion" ADD CONSTRAINT "caja_sesion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_caja_sesion_id_fkey" FOREIGN KEY ("caja_sesion_id") REFERENCES "caja_sesion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_venta_pago_id_fkey" FOREIGN KEY ("venta_pago_id") REFERENCES "venta_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodo_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimiento" ADD CONSTRAINT "caja_movimiento_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
