-- CreateEnum
CREATE TYPE "VentaTipoComprobante" AS ENUM ('nota_venta', 'factura', 'boleta');

-- CreateEnum
CREATE TYPE "VentaEstado" AS ENUM ('pendiente', 'completada', 'anulada');

-- CreateEnum
CREATE TYPE "VentaDescuentoTipo" AS ENUM ('porcentaje', 'monto');

-- CreateEnum
CREATE TYPE "VentaPagoEstado" AS ENUM ('activo', 'anulado');

-- CreateTable
CREATE TABLE "serie_comprobante" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT,
    "tipo_comprobante" "VentaTipoComprobante" NOT NULL,
    "serie" VARCHAR(4) NOT NULL,
    "numero_actual" INTEGER NOT NULL DEFAULT 0,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "serie_comprobante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta" (
    "id" BIGSERIAL NOT NULL,
    "public_id" VARCHAR(30) NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT,
    "cliente_id" BIGINT,
    "serie_comprobante_id" BIGINT NOT NULL,
    "tipo_comprobante" "VentaTipoComprobante" NOT NULL,
    "serie" VARCHAR(4) NOT NULL,
    "numero" INTEGER NOT NULL,
    "correlativo" VARCHAR(15) NOT NULL,
    "descuento_tipo" "VentaDescuentoTipo",
    "descuento_valor" DECIMAL(10,2),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "estado" "VentaEstado" NOT NULL DEFAULT 'completada',
    "observaciones" VARCHAR(500),
    "anulado_at" TIMESTAMPTZ(6),
    "anulado_razon" VARCHAR(500),
    "creado_por_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_detalle" (
    "id" BIGSERIAL NOT NULL,
    "venta_id" BIGINT NOT NULL,
    "producto_variante_id" BIGINT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "descuento_tipo" "VentaDescuentoTipo",
    "descuento_valor" DECIMAL(10,2),
    "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "venta_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_pago" (
    "id" BIGSERIAL NOT NULL,
    "venta_id" BIGINT NOT NULL,
    "metodo_pago_id" BIGINT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" VARCHAR(200),
    "estado" "VentaPagoEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "venta_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serie_comprobante_empresa_id_tipo_comprobante_serie_key" ON "serie_comprobante"("empresa_id", "tipo_comprobante", "serie");

-- CreateIndex
CREATE INDEX "serie_comprobante_empresa_id_idx" ON "serie_comprobante"("empresa_id");

-- CreateIndex
CREATE INDEX "serie_comprobante_empresa_id_tipo_comprobante_idx" ON "serie_comprobante"("empresa_id", "tipo_comprobante");

-- CreateIndex
CREATE INDEX "serie_comprobante_es_principal_idx" ON "serie_comprobante"("es_principal");

-- CreateIndex
CREATE UNIQUE INDEX "venta_public_id_key" ON "venta"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "venta_serie_comprobante_id_numero_key" ON "venta"("serie_comprobante_id", "numero");

-- CreateIndex
CREATE INDEX "venta_empresa_id_idx" ON "venta"("empresa_id");

-- CreateIndex
CREATE INDEX "venta_empresa_id_tipo_comprobante_idx" ON "venta"("empresa_id", "tipo_comprobante");

-- CreateIndex
CREATE INDEX "venta_empresa_id_estado_idx" ON "venta"("empresa_id", "estado");

-- CreateIndex
CREATE INDEX "venta_sucursal_id_idx" ON "venta"("sucursal_id");

-- CreateIndex
CREATE INDEX "venta_cliente_id_idx" ON "venta"("cliente_id");

-- CreateIndex
CREATE INDEX "venta_serie_numero_idx" ON "venta"("serie", "numero");

-- CreateIndex
CREATE INDEX "venta_correlativo_idx" ON "venta"("correlativo");

-- CreateIndex
CREATE INDEX "venta_created_at_idx" ON "venta"("created_at");

-- CreateIndex
CREATE INDEX "venta_detalle_venta_id_idx" ON "venta_detalle"("venta_id");

-- CreateIndex
CREATE INDEX "venta_detalle_producto_variante_id_idx" ON "venta_detalle"("producto_variante_id");

-- CreateIndex
CREATE INDEX "venta_pago_venta_id_idx" ON "venta_pago"("venta_id");

-- CreateIndex
CREATE INDEX "venta_pago_metodo_pago_id_idx" ON "venta_pago"("metodo_pago_id");

-- AddForeignKey
ALTER TABLE "serie_comprobante" ADD CONSTRAINT "serie_comprobante_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serie_comprobante" ADD CONSTRAINT "serie_comprobante_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_serie_comprobante_id_fkey" FOREIGN KEY ("serie_comprobante_id") REFERENCES "serie_comprobante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta" ADD CONSTRAINT "venta_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_pago" ADD CONSTRAINT "venta_pago_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_pago" ADD CONSTRAINT "venta_pago_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodo_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;