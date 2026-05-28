-- CreateEnum
CREATE TYPE "CotizacionEstado" AS ENUM ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'convertida', 'anulada');

-- CreateTable
CREATE TABLE "cotizacion" (
    "id" BIGSERIAL NOT NULL,
    "public_id" VARCHAR(30) NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT,
    "cliente_id" BIGINT,
    "serie" VARCHAR(4) NOT NULL,
    "numero" INTEGER NOT NULL,
    "correlativo" VARCHAR(15) NOT NULL,
    "estado" "CotizacionEstado" NOT NULL DEFAULT 'borrador',
    "descuento_tipo" "VentaDescuentoTipo",
    "descuento_valor" DECIMAL(10,2),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "observaciones" VARCHAR(500),
    "valida_hasta" TIMESTAMPTZ(6),
    "convertida_venta_id" BIGINT,
    "creado_por_id" BIGINT,
    "anulado_at" TIMESTAMPTZ(6),
    "anulado_razon" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_detalle" (
    "id" BIGSERIAL NOT NULL,
    "cotizacion_id" BIGINT NOT NULL,
    "producto_variante_id" BIGINT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "descuento_tipo" "VentaDescuentoTipo",
    "descuento_valor" DECIMAL(10,2),
    "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "cotizacion_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_public_id_key" ON "cotizacion"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_convertida_venta_id_key" ON "cotizacion"("convertida_venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_empresa_id_serie_numero_key" ON "cotizacion"("empresa_id", "serie", "numero");

-- CreateIndex
CREATE INDEX "cotizacion_empresa_id_idx" ON "cotizacion"("empresa_id");

-- CreateIndex
CREATE INDEX "cotizacion_empresa_id_estado_idx" ON "cotizacion"("empresa_id", "estado");

-- CreateIndex
CREATE INDEX "cotizacion_sucursal_id_idx" ON "cotizacion"("sucursal_id");

-- CreateIndex
CREATE INDEX "cotizacion_cliente_id_idx" ON "cotizacion"("cliente_id");

-- CreateIndex
CREATE INDEX "cotizacion_serie_numero_idx" ON "cotizacion"("serie", "numero");

-- CreateIndex
CREATE INDEX "cotizacion_correlativo_idx" ON "cotizacion"("correlativo");

-- CreateIndex
CREATE INDEX "cotizacion_created_at_idx" ON "cotizacion"("created_at");

-- CreateIndex
CREATE INDEX "cotizacion_valida_hasta_idx" ON "cotizacion"("valida_hasta");

-- CreateIndex
CREATE INDEX "cotizacion_detalle_cotizacion_id_idx" ON "cotizacion_detalle"("cotizacion_id");

-- CreateIndex
CREATE INDEX "cotizacion_detalle_producto_variante_id_idx" ON "cotizacion_detalle"("producto_variante_id");

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_convertida_venta_id_fkey" FOREIGN KEY ("convertida_venta_id") REFERENCES "venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_detalle" ADD CONSTRAINT "cotizacion_detalle_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_detalle" ADD CONSTRAINT "cotizacion_detalle_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
