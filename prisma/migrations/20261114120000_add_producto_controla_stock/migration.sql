-- Control de stock por producto
ALTER TABLE "producto"
ADD COLUMN "controla_stock" BOOLEAN NOT NULL DEFAULT true;

-- Snapshot en el detalle de venta para saber si esa venta movio inventario
ALTER TABLE "venta_detalle"
ADD COLUMN "afecta_stock" BOOLEAN NOT NULL DEFAULT true;
