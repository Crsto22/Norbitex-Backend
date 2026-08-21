CREATE TYPE "CompraComprobanteTipo" AS ENUM ('factura', 'boleta', 'otro');

ALTER TYPE "StockMovimientoTipo" ADD VALUE IF NOT EXISTS 'compra';

CREATE TABLE "proveedor" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "ruc" VARCHAR(11) NOT NULL,
  "razon_social" VARCHAR(200) NOT NULL,
  "nombre_comercial" VARCHAR(200),
  "direccion" VARCHAR(255),
  "telefono" VARCHAR(30),
  "email" VARCHAR(150),
  "persona_contacto" VARCHAR(150),
  "telefono_contacto" VARCHAR(30),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compra_orden" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "proveedor_id" BIGINT NOT NULL,
  "destino_sucursal_id" BIGINT NOT NULL,
  "creado_por_id" BIGINT,
  "proveedor_ruc" VARCHAR(11) NOT NULL,
  "proveedor_razon_social" VARCHAR(200) NOT NULL,
  "tipo_comprobante" "CompraComprobanteTipo",
  "fecha_emision" DATE,
  "serie" VARCHAR(20),
  "numero" VARCHAR(30),
  "total" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compra_orden_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compra_orden_detalle" (
  "id" BIGSERIAL NOT NULL,
  "orden_id" BIGINT NOT NULL,
  "producto_variante_id" BIGINT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "costo_unitario" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compra_orden_detalle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proveedor_empresa_id_ruc_key" ON "proveedor"("empresa_id", "ruc");
CREATE INDEX "proveedor_empresa_id_idx" ON "proveedor"("empresa_id");
CREATE INDEX "proveedor_empresa_id_activo_idx" ON "proveedor"("empresa_id", "activo");
CREATE INDEX "proveedor_empresa_id_created_at_idx" ON "proveedor"("empresa_id", "created_at");

CREATE UNIQUE INDEX "compra_orden_public_id_key" ON "compra_orden"("public_id");
CREATE INDEX "compra_orden_empresa_id_created_at_idx" ON "compra_orden"("empresa_id", "created_at");
CREATE INDEX "compra_orden_empresa_id_proveedor_id_created_at_idx" ON "compra_orden"("empresa_id", "proveedor_id", "created_at");
CREATE INDEX "compra_orden_empresa_id_destino_sucursal_id_created_at_idx" ON "compra_orden"("empresa_id", "destino_sucursal_id", "created_at");
CREATE INDEX "compra_orden_empresa_id_tipo_comprobante_serie_numero_idx" ON "compra_orden"("empresa_id", "tipo_comprobante", "serie", "numero");

CREATE UNIQUE INDEX "compra_orden_detalle_orden_id_producto_variante_id_key" ON "compra_orden_detalle"("orden_id", "producto_variante_id");
CREATE INDEX "compra_orden_detalle_producto_variante_id_idx" ON "compra_orden_detalle"("producto_variante_id");

ALTER TABLE "proveedor"
ADD CONSTRAINT "proveedor_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compra_orden"
ADD CONSTRAINT "compra_orden_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compra_orden"
ADD CONSTRAINT "compra_orden_proveedor_id_fkey"
FOREIGN KEY ("proveedor_id") REFERENCES "proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compra_orden"
ADD CONSTRAINT "compra_orden_destino_sucursal_id_fkey"
FOREIGN KEY ("destino_sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compra_orden"
ADD CONSTRAINT "compra_orden_creado_por_id_fkey"
FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compra_orden_detalle"
ADD CONSTRAINT "compra_orden_detalle_orden_id_fkey"
FOREIGN KEY ("orden_id") REFERENCES "compra_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compra_orden_detalle"
ADD CONSTRAINT "compra_orden_detalle_producto_variante_id_fkey"
FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT "id", 'compras-ordenes'
FROM "empresa_usuario"
ON CONFLICT ("empresa_usuario_id", "module_key") DO NOTHING;

INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT "id", 'compras-proveedores'
FROM "empresa_usuario"
ON CONFLICT ("empresa_usuario_id", "module_key") DO NOTHING;
