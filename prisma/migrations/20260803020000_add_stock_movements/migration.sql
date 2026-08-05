CREATE TYPE "StockMovimientoDireccion" AS ENUM ('entrada', 'salida');
CREATE TYPE "StockMovimientoTipo" AS ENUM (
  'saldo_apertura',
  'stock_inicial',
  'entrada_manual',
  'salida_manual',
  'ajuste_producto',
  'venta',
  'anulacion_venta',
  'nota_credito',
  'traspaso_entrada',
  'traspaso_salida'
);

CREATE TABLE "stock_traspaso" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "origen_sucursal_id" BIGINT NOT NULL,
  "destino_sucursal_id" BIGINT NOT NULL,
  "motivo" VARCHAR(500) NOT NULL,
  "creado_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_traspaso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_traspaso_detalle" (
  "id" BIGSERIAL NOT NULL,
  "traspaso_id" BIGINT NOT NULL,
  "producto_variante_id" BIGINT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  CONSTRAINT "stock_traspaso_detalle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movimiento" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT NOT NULL,
  "producto_variante_id" BIGINT NOT NULL,
  "direccion" "StockMovimientoDireccion" NOT NULL,
  "tipo" "StockMovimientoTipo" NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "stock_anterior" INTEGER NOT NULL,
  "stock_posterior" INTEGER NOT NULL,
  "motivo" VARCHAR(500),
  "referencia_tipo" VARCHAR(40),
  "referencia_id" BIGINT,
  "traspaso_id" BIGINT,
  "creado_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movimiento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_traspaso_public_id_key" ON "stock_traspaso"("public_id");
CREATE INDEX "stock_traspaso_empresa_id_created_at_idx" ON "stock_traspaso"("empresa_id", "created_at");
CREATE INDEX "stock_traspaso_empresa_id_origen_sucursal_id_created_at_idx" ON "stock_traspaso"("empresa_id", "origen_sucursal_id", "created_at");
CREATE INDEX "stock_traspaso_empresa_id_destino_sucursal_id_created_at_idx" ON "stock_traspaso"("empresa_id", "destino_sucursal_id", "created_at");
CREATE UNIQUE INDEX "stock_traspaso_detalle_traspaso_id_producto_variante_id_key" ON "stock_traspaso_detalle"("traspaso_id", "producto_variante_id");
CREATE INDEX "stock_traspaso_detalle_producto_variante_id_idx" ON "stock_traspaso_detalle"("producto_variante_id");
CREATE INDEX "stock_movimiento_empresa_id_created_at_idx" ON "stock_movimiento"("empresa_id", "created_at");
CREATE INDEX "stock_movimiento_empresa_id_sucursal_id_created_at_idx" ON "stock_movimiento"("empresa_id", "sucursal_id", "created_at");
CREATE INDEX "stock_movimiento_empresa_id_producto_variante_id_created_at_idx" ON "stock_movimiento"("empresa_id", "producto_variante_id", "created_at");
CREATE INDEX "stock_movimiento_traspaso_id_idx" ON "stock_movimiento"("traspaso_id");

ALTER TABLE "stock_traspaso" ADD CONSTRAINT "stock_traspaso_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_traspaso" ADD CONSTRAINT "stock_traspaso_origen_sucursal_id_fkey" FOREIGN KEY ("origen_sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_traspaso" ADD CONSTRAINT "stock_traspaso_destino_sucursal_id_fkey" FOREIGN KEY ("destino_sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_traspaso" ADD CONSTRAINT "stock_traspaso_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_traspaso_detalle" ADD CONSTRAINT "stock_traspaso_detalle_traspaso_id_fkey" FOREIGN KEY ("traspaso_id") REFERENCES "stock_traspaso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_traspaso_detalle" ADD CONSTRAINT "stock_traspaso_detalle_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movimiento" ADD CONSTRAINT "stock_movimiento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movimiento" ADD CONSTRAINT "stock_movimiento_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movimiento" ADD CONSTRAINT "stock_movimiento_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movimiento" ADD CONSTRAINT "stock_movimiento_traspaso_id_fkey" FOREIGN KEY ("traspaso_id") REFERENCES "stock_traspaso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movimiento" ADD CONSTRAINT "stock_movimiento_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "stock_movimiento" (
  "empresa_id", "sucursal_id", "producto_variante_id", "direccion", "tipo",
  "cantidad", "stock_anterior", "stock_posterior", "motivo", "created_at"
)
SELECT
  "empresa_id", "sucursal_id", "producto_variante_id", 'entrada',
  'saldo_apertura', "stock_actual", 0, "stock_actual",
  'Saldo de apertura al habilitar el modulo Stock', CURRENT_TIMESTAMP
FROM "inventario_sucursal"
WHERE "stock_actual" > 0;
