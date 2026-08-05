ALTER TABLE "tarifa_plan"
ADD COLUMN "descuento_mensual_porcentaje" DECIMAL(5, 2) NOT NULL DEFAULT 0;

INSERT INTO "tarifa_plan" (
  "plan_codigo",
  "precio_mensual",
  "descuento_mensual_porcentaje",
  "descuento_anual_porcentaje"
) VALUES ('basico', 20.00, 0.00, 0.00);

INSERT INTO "limite_plan" (
  "plan_codigo",
  "usuarios",
  "sucursales",
  "productos",
  "variantes",
  "comprobantes",
  "consultas_documento",
  "almacenamiento_bytes"
) VALUES ('basico', 1, 1, 100, 1000, 100, 20, 262144000);
