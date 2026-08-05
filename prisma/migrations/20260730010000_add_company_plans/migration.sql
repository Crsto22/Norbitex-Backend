CREATE TYPE "PlanCodigo" AS ENUM ('prueba', 'emprendedor', 'crecimiento', 'empresarial');

ALTER TABLE "empresa"
ADD COLUMN "plan_codigo" "PlanCodigo" NOT NULL DEFAULT 'empresarial',
ADD COLUMN "plan_inicio_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "plan_fin_at" TIMESTAMPTZ(6);

ALTER TABLE "empresa"
ALTER COLUMN "plan_codigo" SET DEFAULT 'prueba';
