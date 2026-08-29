CREATE TYPE "PlanEstado" AS ENUM ('activo', 'inactivo');

CREATE TABLE "plan" (
  "plan_codigo" "PlanCodigo" NOT NULL,
  "nombre" VARCHAR(120) NOT NULL,
  "descripcion" VARCHAR(300),
  "estado" "PlanEstado" NOT NULL DEFAULT 'activo',
  "trial_days" INTEGER,
  "actualizado_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_pkey" PRIMARY KEY ("plan_codigo")
);

CREATE TABLE "plan_modulo" (
  "id" BIGSERIAL NOT NULL,
  "plan_codigo" "PlanCodigo" NOT NULL,
  "module_key" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "actualizado_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_modulo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "empresa_modulo_plan" (
  "id" BIGSERIAL NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "module_key" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "actualizado_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_modulo_plan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "limite_plan"
  ADD COLUMN "trabajadores_asistencia" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "puntos_qr_asistencia" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "empresa_limite_adicional"
  ADD COLUMN "trabajadores_asistencia" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "puntos_qr_asistencia" BIGINT NOT NULL DEFAULT 0;

CREATE INDEX "plan_estado_idx" ON "plan"("estado");
CREATE INDEX "plan_actualizado_por_id_idx" ON "plan"("actualizado_por_id");
CREATE UNIQUE INDEX "plan_modulo_plan_codigo_module_key_key" ON "plan_modulo"("plan_codigo", "module_key");
CREATE INDEX "plan_modulo_module_key_idx" ON "plan_modulo"("module_key");
CREATE INDEX "plan_modulo_actualizado_por_id_idx" ON "plan_modulo"("actualizado_por_id");
CREATE UNIQUE INDEX "empresa_modulo_plan_empresa_id_module_key_key" ON "empresa_modulo_plan"("empresa_id", "module_key");
CREATE INDEX "empresa_modulo_plan_module_key_idx" ON "empresa_modulo_plan"("module_key");
CREATE INDEX "empresa_modulo_plan_actualizado_por_id_idx" ON "empresa_modulo_plan"("actualizado_por_id");

ALTER TABLE "plan" ADD CONSTRAINT "plan_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plan_modulo" ADD CONSTRAINT "plan_modulo_plan_codigo_fkey"
  FOREIGN KEY ("plan_codigo") REFERENCES "plan"("plan_codigo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_modulo" ADD CONSTRAINT "plan_modulo_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "empresa_modulo_plan" ADD CONSTRAINT "empresa_modulo_plan_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "empresa_modulo_plan" ADD CONSTRAINT "empresa_modulo_plan_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "plan" ("plan_codigo", "nombre", "descripcion", "estado", "trial_days")
VALUES
  ('prueba', 'Prueba', 'Plan temporal de evaluacion', 'activo', 7),
  ('basico', 'Básico', 'Plan base actual', 'activo', NULL),
  ('emprendedor', 'Emprende', 'Plan emprendedor actual', 'activo', NULL),
  ('crecimiento', 'Crece', 'Plan crecimiento actual', 'activo', NULL),
  ('empresarial', 'Escala', 'Plan empresarial actual', 'activo', NULL),
  ('pos_basico', 'POS Básico', 'POS e inventario sin asistencias', 'activo', NULL),
  ('asistencias_basico', 'Asistencias Básico', 'Asistencias para equipos pequeños', 'activo', NULL),
  ('asistencias_pro', 'Asistencias Pro', 'Asistencias para equipos en crecimiento', 'activo', NULL),
  ('completo_emprende', 'Completo Emprende', 'POS y asistencias para negocios pequeños', 'activo', NULL),
  ('completo_empresa', 'Completo Empresa', 'POS y asistencias completo', 'activo', NULL)
ON CONFLICT ("plan_codigo") DO UPDATE SET
  "nombre" = EXCLUDED."nombre",
  "descripcion" = EXCLUDED."descripcion",
  "trial_days" = EXCLUDED."trial_days";

INSERT INTO "tarifa_plan" ("plan_codigo", "precio_mensual", "descuento_mensual_porcentaje", "descuento_anual_porcentaje")
VALUES
  ('pos_basico', 39.00, 0.00, 10.00),
  ('asistencias_basico', 39.00, 0.00, 10.00),
  ('asistencias_pro', 79.00, 0.00, 10.00),
  ('completo_emprende', 99.00, 0.00, 10.00),
  ('completo_empresa', 249.00, 0.00, 10.00)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "limite_plan" (
  "plan_codigo", "usuarios", "sucursales", "almacenes", "productos", "variantes",
  "comprobantes", "consultas_documento", "almacenamiento_bytes",
  "trabajadores_asistencia", "puntos_qr_asistencia"
)
VALUES
  ('pos_basico', 1, 1, 5, 100, 1000, 250, 50, 3221225472, 0, 0),
  ('asistencias_basico', 1, 1, 0, 0, 0, 0, 0, 536870912, 10, 1),
  ('asistencias_pro', 3, 2, 0, 0, 0, 0, 0, 1073741824, 30, 3),
  ('completo_emprende', 3, 2, 5, 450, 5000, 1000, 250, 10737418240, 15, 2),
  ('completo_empresa', 10, 5, NULL, 10000, 100000, 10000, 2500, 107374182400, 100, 10)
ON CONFLICT ("plan_codigo") DO NOTHING;

UPDATE "limite_plan"
SET
  "trabajadores_asistencia" = CASE "plan_codigo"
    WHEN 'prueba' THEN 10
    WHEN 'basico' THEN 10
    WHEN 'emprendedor' THEN 15
    WHEN 'crecimiento' THEN 30
    WHEN 'empresarial' THEN 100
    ELSE "trabajadores_asistencia"
  END,
  "puntos_qr_asistencia" = CASE "plan_codigo"
    WHEN 'prueba' THEN 1
    WHEN 'basico' THEN 1
    WHEN 'emprendedor' THEN 2
    WHEN 'crecimiento' THEN 3
    WHEN 'empresarial' THEN 10
    ELSE "puntos_qr_asistencia"
  END
WHERE "plan_codigo" IN ('prueba', 'basico', 'emprendedor', 'crecimiento', 'empresarial');

WITH modules(module_key) AS (
  SELECT unnest(ARRAY[
    'dashboard','ventas-pos','caja','cotizaciones','entregas-pendientes','clientes',
    'historial-ventas','historial-cotizaciones','comprobantes','nota-credito','series',
    'productos','categorias','marcas','tallas','colores','stock-movimientos',
    'stock-traspasos','stock-kardex','compras-ordenes','compras-proveedores',
    'sucursales','usuarios','reportes-ventas','reportes-productos','empresa',
    'metodos-pago','mi-cuenta','asistencias-dashboard','asistencias-personal',
    'asistencias-marcajes','asistencias-historial-marcaciones','asistencias-turnos',
    'asistencias-puntos-qr','asistencias-reportes','asistencias-configuracion',
    'reportes-clientes','reportes-usuarios','gre-remitente','conductores'
  ])
), plans(plan_codigo) AS (
  SELECT unnest(ARRAY['prueba','crecimiento','empresarial','completo_empresa']::"PlanCodigo"[])
)
INSERT INTO "plan_modulo" ("plan_codigo", "module_key", "enabled")
SELECT plans.plan_codigo, modules.module_key, true FROM plans CROSS JOIN modules
ON CONFLICT ("plan_codigo", "module_key") DO NOTHING;

WITH modules(module_key) AS (
  SELECT unnest(ARRAY[
    'dashboard','ventas-pos','cotizaciones','entregas-pendientes','clientes',
    'historial-ventas','historial-cotizaciones','comprobantes','nota-credito','series',
    'productos','categorias','marcas','tallas','colores','stock-movimientos',
    'stock-traspasos','stock-kardex','compras-ordenes','compras-proveedores',
    'sucursales','reportes-ventas','reportes-productos','empresa','metodos-pago','mi-cuenta'
  ])
), plans(plan_codigo) AS (
  SELECT unnest(ARRAY['basico','pos_basico']::"PlanCodigo"[])
)
INSERT INTO "plan_modulo" ("plan_codigo", "module_key", "enabled")
SELECT plans.plan_codigo, modules.module_key, true FROM plans CROSS JOIN modules
ON CONFLICT ("plan_codigo", "module_key") DO NOTHING;

WITH modules(module_key) AS (
  SELECT unnest(ARRAY[
    'asistencias-dashboard','asistencias-personal','asistencias-marcajes',
    'asistencias-historial-marcaciones','asistencias-turnos','asistencias-puntos-qr',
    'asistencias-reportes','asistencias-configuracion'
  ])
), plans(plan_codigo) AS (
  SELECT unnest(ARRAY['asistencias_basico','asistencias_pro']::"PlanCodigo"[])
)
INSERT INTO "plan_modulo" ("plan_codigo", "module_key", "enabled")
SELECT plans.plan_codigo, modules.module_key, true FROM plans CROSS JOIN modules
ON CONFLICT ("plan_codigo", "module_key") DO NOTHING;

WITH modules(module_key) AS (
  SELECT unnest(ARRAY[
    'dashboard','ventas-pos','cotizaciones','entregas-pendientes','clientes',
    'historial-ventas','historial-cotizaciones','comprobantes','nota-credito','series',
    'productos','categorias','marcas','tallas','colores','stock-movimientos',
    'stock-traspasos','stock-kardex','compras-ordenes','compras-proveedores',
    'sucursales','reportes-ventas','reportes-productos','empresa','metodos-pago','mi-cuenta',
    'asistencias-dashboard','asistencias-personal','asistencias-marcajes',
    'asistencias-historial-marcaciones','asistencias-turnos','asistencias-puntos-qr',
    'asistencias-reportes','asistencias-configuracion'
  ])
)
INSERT INTO "plan_modulo" ("plan_codigo", "module_key", "enabled")
SELECT 'completo_emprende', modules.module_key, true FROM modules
ON CONFLICT ("plan_codigo", "module_key") DO NOTHING;
