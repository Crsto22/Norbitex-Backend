-- Un usuario solo puede estar asociado a una empresa.
DROP INDEX IF EXISTS "empresa_usuario_usuario_id_idx";

ALTER TABLE "empresa_usuario"
ADD CONSTRAINT "empresa_usuario_usuario_id_key" UNIQUE ("usuario_id");
