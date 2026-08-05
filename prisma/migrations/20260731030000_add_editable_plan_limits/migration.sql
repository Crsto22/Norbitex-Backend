CREATE TABLE "limite_plan" (
  "plan_codigo" "PlanCodigo" NOT NULL,
  "usuarios" BIGINT NOT NULL,
  "sucursales" BIGINT NOT NULL,
  "productos" BIGINT NOT NULL,
  "variantes" BIGINT NOT NULL,
  "comprobantes" BIGINT NOT NULL,
  "almacenamiento_bytes" BIGINT NOT NULL,
  "actualizado_por_id" BIGINT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "limite_plan_pkey" PRIMARY KEY ("plan_codigo")
);

INSERT INTO "limite_plan" (
  "plan_codigo", "usuarios", "sucursales", "productos", "variantes",
  "comprobantes", "almacenamiento_bytes"
) VALUES
  ('prueba', 1, 1, 50, 500, 50, 104857600),
  ('emprendedor', 2, 1, 500, 5000, 500, 1073741824),
  ('crecimiento', 7, 3, 3000, 30000, 3000, 5368709120),
  ('empresarial', 25, 10, 10000, 100000, 10000, 21474836480);

CREATE INDEX "limite_plan_actualizado_por_id_idx"
ON "limite_plan"("actualizado_por_id");

ALTER TABLE "limite_plan"
ADD CONSTRAINT "limite_plan_actualizado_por_id_fkey"
FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
