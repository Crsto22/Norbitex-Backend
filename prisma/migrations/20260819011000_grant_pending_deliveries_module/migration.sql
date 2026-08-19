INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT "id", 'entregas-pendientes'
FROM "empresa_usuario"
ON CONFLICT ("empresa_usuario_id", "module_key") DO NOTHING;
