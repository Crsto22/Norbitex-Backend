ALTER TABLE "limite_plan" ADD COLUMN "almacenes" BIGINT;
ALTER TABLE "empresa_limite_adicional" ADD COLUMN "almacenes" BIGINT NOT NULL DEFAULT 0;

UPDATE "limite_plan"
SET "almacenes" = CASE
  WHEN "plan_codigo" IN ('prueba', 'basico', 'emprendedor') THEN 5
  ELSE NULL
END;
