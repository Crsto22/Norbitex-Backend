-- Repara el drift de "venta_detalle":
-- la columna legacy "precioUnitario" (camelCase, creada por un `prisma db push`
-- antiguo) guarda los precios reales, mientras que "precio_unitario" (la que
-- usa Prisma hoy) quedo en NULL y sin restriccion NOT NULL.
--
-- Sintoma que corrige: P2032 "Error converting field precioUnitario of
-- expected non-nullable type Decimal, found incompatible value of null"
-- al leer ventas con detalles.

-- 1) Copia el dato legacy a la columna actual y elimina la columna legacy.
--    El bloque solo actua en bases que tengan el drift (produccion); en una
--    base nueva no hace nada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'venta_detalle'
      AND column_name = 'precioUnitario'
  ) THEN
    CREATE TABLE IF NOT EXISTS "venta_detalle_bak_20261115"
      AS SELECT * FROM "venta_detalle";

    EXECUTE '
      UPDATE "venta_detalle"
      SET "precio_unitario" = "precioUnitario"
      WHERE "precio_unitario" IS NULL
        AND "precioUnitario" IS NOT NULL';

    EXECUTE 'ALTER TABLE "venta_detalle" DROP COLUMN "precioUnitario"';
  END IF;
END $$;

-- 2) Red de seguridad: si alguna fila siguiera sin precio, se deriva del
--    subtotal (precio unitario sin descuento) y la cantidad.
UPDATE "venta_detalle"
SET "precio_unitario" = round("subtotal" / NULLIF("cantidad", 0), 2)
WHERE "precio_unitario" IS NULL;

-- 3) Restaura la restriccion que espera el schema de Prisma.
ALTER TABLE "venta_detalle"
  ALTER COLUMN "precio_unitario" SET NOT NULL;
