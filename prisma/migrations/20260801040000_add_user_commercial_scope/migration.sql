CREATE TYPE "VisibilidadOperaciones" AS ENUM ('propias', 'todas');

ALTER TABLE "empresa_usuario"
ADD COLUMN "sucursal_id" BIGINT,
ADD COLUMN "visibilidad_operaciones" "VisibilidadOperaciones" NOT NULL DEFAULT 'todas';

CREATE INDEX "empresa_usuario_empresa_id_sucursal_id_idx"
ON "empresa_usuario"("empresa_id", "sucursal_id");

ALTER TABLE "empresa_usuario"
ADD CONSTRAINT "empresa_usuario_sucursal_id_fkey"
FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
