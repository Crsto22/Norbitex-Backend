-- Antes del centro logistico, las ventas inmediatas nacian con todas sus
-- cantidades entregadas. Si luego se generaba un enlace Shalom/Olva, esas
-- cantidades no se convertian en pendientes. Conservamos cualquier entrega
-- explicita registrada y corregimos unicamente las ventas sin entrega real.
UPDATE "venta_detalle" AS vd
SET "cantidad_entregada" = 0
WHERE EXISTS (
  SELECT 1
  FROM "venta_envio" AS ve
  WHERE ve."venta_id" = vd."venta_id"
)
AND NOT EXISTS (
  SELECT 1
  FROM "venta_entrega" AS delivery
  WHERE delivery."venta_id" = vd."venta_id"
);

UPDATE "venta" AS v
SET "estado_entrega" = 'pendiente'
WHERE EXISTS (
  SELECT 1
  FROM "venta_envio" AS ve
  WHERE ve."venta_id" = v."id"
)
AND NOT EXISTS (
  SELECT 1
  FROM "venta_entrega" AS delivery
  WHERE delivery."venta_id" = v."id"
);
