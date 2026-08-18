ALTER TABLE "inventario_sucursal"
ADD COLUMN "costo_promedio" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN "valor_stock" DECIMAL(14,4) NOT NULL DEFAULT 0;

ALTER TABLE "stock_movimiento"
ADD COLUMN "costo_unitario" DECIMAL(12,4),
ADD COLUMN "costo_promedio_anterior" DECIMAL(12,4),
ADD COLUMN "costo_promedio_posterior" DECIMAL(12,4),
ADD COLUMN "valor_movimiento" DECIMAL(14,4),
ADD COLUMN "valor_stock_anterior" DECIMAL(14,4),
ADD COLUMN "valor_stock_posterior" DECIMAL(14,4);

UPDATE "inventario_sucursal" inv
SET
  "costo_promedio" = COALESCE(pv."precio_compra", 0),
  "valor_stock" = inv."stock_actual" * COALESCE(pv."precio_compra", 0)
FROM "producto_variante" pv
WHERE pv."id" = inv."producto_variante_id";
