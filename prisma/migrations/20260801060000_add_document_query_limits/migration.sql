CREATE TYPE "ConsultaDocumentoTipo" AS ENUM ('dni', 'ruc');

ALTER TABLE "limite_plan"
ADD COLUMN "consultas_documento" BIGINT NOT NULL DEFAULT 0;

UPDATE "limite_plan"
SET "consultas_documento" = CASE "plan_codigo"
  WHEN 'prueba' THEN 10
  WHEN 'emprendedor' THEN 50
  WHEN 'crecimiento' THEN 300
  WHEN 'empresarial' THEN 1000
END;

ALTER TABLE "empresa_limite_adicional"
ADD COLUMN "consultas_documento" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "consulta_documento" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "usuario_id" BIGINT NOT NULL,
  "tipo" "ConsultaDocumentoTipo" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consulta_documento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consulta_documento_empresa_id_created_at_idx"
ON "consulta_documento"("empresa_id", "created_at");

CREATE INDEX "consulta_documento_usuario_id_created_at_idx"
ON "consulta_documento"("usuario_id", "created_at");

ALTER TABLE "consulta_documento"
ADD CONSTRAINT "consulta_documento_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consulta_documento"
ADD CONSTRAINT "consulta_documento_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
