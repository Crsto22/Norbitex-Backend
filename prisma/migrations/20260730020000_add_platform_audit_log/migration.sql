CREATE TABLE "platform_audit_log" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT,
  "usuario_id" BIGINT,
  "category" VARCHAR(40) NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "description" VARCHAR(300) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_log_category_created_at_idx"
ON "platform_audit_log"("category", "created_at");

CREATE INDEX "platform_audit_log_action_created_at_idx"
ON "platform_audit_log"("action", "created_at");

CREATE INDEX "platform_audit_log_empresa_id_created_at_idx"
ON "platform_audit_log"("empresa_id", "created_at");

CREATE INDEX "platform_audit_log_usuario_id_created_at_idx"
ON "platform_audit_log"("usuario_id", "created_at");

CREATE INDEX "platform_audit_log_created_at_idx"
ON "platform_audit_log"("created_at");

ALTER TABLE "platform_audit_log"
ADD CONSTRAINT "platform_audit_log_empresa_id_fkey"
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_audit_log"
ADD CONSTRAINT "platform_audit_log_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "platform_audit_log" (
  "empresa_id",
  "usuario_id",
  "category",
  "action",
  "source",
  "description",
  "metadata",
  "created_at"
)
SELECT
  e."id",
  owner_user."usuario_id",
  'company',
  'company_created',
  'historical',
  'Empresa registrada en Nobitex',
  jsonb_build_object('planCode', e."plan_codigo"),
  e."created_at"
FROM "empresa" e
LEFT JOIN LATERAL (
  SELECT eu."usuario_id"
  FROM "empresa_usuario" eu
  JOIN "empresa_usuario_rol" eur ON eur."empresa_usuario_id" = eu."id"
  JOIN "rol" r ON r."id" = eur."rol_id" AND r."codigo" = 'OWNER'
  WHERE eu."empresa_id" = e."id"
  ORDER BY eu."id"
  LIMIT 1
) owner_user ON TRUE;
