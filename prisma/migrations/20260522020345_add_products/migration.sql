-- CreateTable
CREATE TABLE "unidad_medida" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "descripcion" VARCHAR(120) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "unidad_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_afectacion_igv" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(4) NOT NULL,
    "descripcion" VARCHAR(180) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tipo_afectacion_igv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "marca_id" BIGINT,
    "categoria_id" BIGINT,
    "unidad_medida_id" BIGINT NOT NULL,
    "tipo_afectacion_igv_id" BIGINT NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "nombre_key" VARCHAR(220) NOT NULL,
    "descripcion" VARCHAR(1000),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_color" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "color_id" BIGINT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "producto_color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_color_imagen" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "producto_color_id" BIGINT NOT NULL,
    "url_original" TEXT NOT NULL,
    "url_webp" TEXT NOT NULL,
    "url_thumbnail" TEXT NOT NULL,
    "r2_key_original" TEXT NOT NULL,
    "r2_key_webp" TEXT NOT NULL,
    "r2_key_thumbnail" TEXT NOT NULL,
    "mime_type" VARCHAR(80) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producto_color_imagen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_variante" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "producto_color_id" BIGINT NOT NULL,
    "talla_id" BIGINT NOT NULL,
    "sku" VARCHAR(80),
    "codigo_barras" VARCHAR(80),
    "precio_compra" DECIMAL(12,2),
    "precio_venta" DECIMAL(12,2) NOT NULL,
    "precio_mayorista" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "producto_variante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_sucursal" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "producto_variante_id" BIGINT NOT NULL,
    "stock_actual" INTEGER NOT NULL DEFAULT 0,
    "stock_minimo" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventario_sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unidad_medida_codigo_key" ON "unidad_medida"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_afectacion_igv_codigo_key" ON "tipo_afectacion_igv"("codigo");

-- CreateIndex
CREATE INDEX "producto_empresa_id_idx" ON "producto"("empresa_id");

-- CreateIndex
CREATE INDEX "producto_marca_id_idx" ON "producto"("marca_id");

-- CreateIndex
CREATE INDEX "producto_categoria_id_idx" ON "producto"("categoria_id");

-- CreateIndex
CREATE INDEX "producto_deleted_at_idx" ON "producto"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "producto_empresa_id_nombre_key_key" ON "producto"("empresa_id", "nombre_key");

-- CreateIndex
CREATE INDEX "producto_color_empresa_id_idx" ON "producto_color"("empresa_id");

-- CreateIndex
CREATE INDEX "producto_color_color_id_idx" ON "producto_color"("color_id");

-- CreateIndex
CREATE UNIQUE INDEX "producto_color_producto_id_color_id_key" ON "producto_color"("producto_id", "color_id");

-- CreateIndex
CREATE INDEX "producto_color_imagen_empresa_id_idx" ON "producto_color_imagen"("empresa_id");

-- CreateIndex
CREATE INDEX "producto_color_imagen_producto_color_id_idx" ON "producto_color_imagen"("producto_color_id");

-- CreateIndex
CREATE INDEX "producto_variante_empresa_id_idx" ON "producto_variante"("empresa_id");

-- CreateIndex
CREATE INDEX "producto_variante_producto_id_idx" ON "producto_variante"("producto_id");

-- CreateIndex
CREATE INDEX "producto_variante_talla_id_idx" ON "producto_variante"("talla_id");

-- CreateIndex
CREATE INDEX "producto_variante_deleted_at_idx" ON "producto_variante"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "producto_variante_producto_color_id_talla_id_key" ON "producto_variante"("producto_color_id", "talla_id");

-- CreateIndex
CREATE UNIQUE INDEX "producto_variante_empresa_id_sku_key" ON "producto_variante"("empresa_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "producto_variante_empresa_id_codigo_barras_key" ON "producto_variante"("empresa_id", "codigo_barras");

-- CreateIndex
CREATE INDEX "inventario_sucursal_empresa_id_idx" ON "inventario_sucursal"("empresa_id");

-- CreateIndex
CREATE INDEX "inventario_sucursal_producto_variante_id_idx" ON "inventario_sucursal"("producto_variante_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_sucursal_sucursal_id_producto_variante_id_key" ON "inventario_sucursal"("sucursal_id", "producto_variante_id");

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_unidad_medida_id_fkey" FOREIGN KEY ("unidad_medida_id") REFERENCES "unidad_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_tipo_afectacion_igv_id_fkey" FOREIGN KEY ("tipo_afectacion_igv_id") REFERENCES "tipo_afectacion_igv"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_color" ADD CONSTRAINT "producto_color_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_color" ADD CONSTRAINT "producto_color_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_color" ADD CONSTRAINT "producto_color_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_color_imagen" ADD CONSTRAINT "producto_color_imagen_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_color_imagen" ADD CONSTRAINT "producto_color_imagen_producto_color_id_fkey" FOREIGN KEY ("producto_color_id") REFERENCES "producto_color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_variante" ADD CONSTRAINT "producto_variante_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_variante" ADD CONSTRAINT "producto_variante_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_variante" ADD CONSTRAINT "producto_variante_producto_color_id_fkey" FOREIGN KEY ("producto_color_id") REFERENCES "producto_color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_variante" ADD CONSTRAINT "producto_variante_talla_id_fkey" FOREIGN KEY ("talla_id") REFERENCES "talla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_sucursal" ADD CONSTRAINT "inventario_sucursal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_sucursal" ADD CONSTRAINT "inventario_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_sucursal" ADD CONSTRAINT "inventario_sucursal_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
