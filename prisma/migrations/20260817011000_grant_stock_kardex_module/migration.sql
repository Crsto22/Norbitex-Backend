INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT DISTINCT eum."empresa_usuario_id", 'stock-kardex'
FROM "empresa_usuario_modulo" eum
WHERE eum."module_key" IN ('stock-movimientos', 'stock-traspasos')
  AND NOT EXISTS (
    SELECT 1
    FROM "empresa_usuario_modulo" existing
    WHERE existing."empresa_usuario_id" = eum."empresa_usuario_id"
      AND existing."module_key" = 'stock-kardex'
  );
