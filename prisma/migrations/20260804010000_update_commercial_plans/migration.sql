UPDATE "tarifa_plan"
SET
  "precio_mensual" = CASE "plan_codigo"
    WHEN 'prueba' THEN 0.00
    WHEN 'basico' THEN 39.00
    WHEN 'emprendedor' THEN 79.00
    WHEN 'crecimiento' THEN 149.00
    WHEN 'empresarial' THEN 299.00
  END,
  "descuento_anual_porcentaje" = CASE
    WHEN "plan_codigo" = 'prueba' THEN 0.00
    ELSE 10.00
  END,
  "actualizado_por_id" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "plan_codigo" IN (
  'prueba',
  'basico',
  'emprendedor',
  'crecimiento',
  'empresarial'
);

UPDATE "limite_plan"
SET
  "usuarios" = CASE "plan_codigo"
    WHEN 'prueba' THEN 1
    WHEN 'basico' THEN 1
    WHEN 'emprendedor' THEN 3
    WHEN 'crecimiento' THEN 10
    WHEN 'empresarial' THEN 30
  END,
  "sucursales" = CASE "plan_codigo"
    WHEN 'prueba' THEN 1
    WHEN 'basico' THEN 1
    WHEN 'emprendedor' THEN 2
    WHEN 'crecimiento' THEN 3
    WHEN 'empresarial' THEN 20
  END,
  "almacenes" = CASE
    WHEN "plan_codigo" IN ('prueba', 'basico', 'emprendedor') THEN 5
    ELSE NULL
  END,
  "productos" = CASE "plan_codigo"
    WHEN 'prueba' THEN 50
    WHEN 'basico' THEN 100
    WHEN 'emprendedor' THEN 450
    WHEN 'crecimiento' THEN 4500
    WHEN 'empresarial' THEN 20000
  END,
  "variantes" = CASE "plan_codigo"
    WHEN 'prueba' THEN 500
    WHEN 'basico' THEN 1000
    WHEN 'emprendedor' THEN 5000
    WHEN 'crecimiento' THEN 45000
    WHEN 'empresarial' THEN 200000
  END,
  "comprobantes" = CASE "plan_codigo"
    WHEN 'prueba' THEN 100
    WHEN 'basico' THEN 250
    WHEN 'emprendedor' THEN 1000
    WHEN 'crecimiento' THEN 5000
    WHEN 'empresarial' THEN 20000
  END,
  "consultas_documento" = CASE "plan_codigo"
    WHEN 'prueba' THEN 20
    WHEN 'basico' THEN 50
    WHEN 'emprendedor' THEN 250
    WHEN 'crecimiento' THEN 1500
    WHEN 'empresarial' THEN 5000
  END,
  "almacenamiento_bytes" = CASE "plan_codigo"
    WHEN 'prueba' THEN 524288000
    WHEN 'basico' THEN 3221225472
    WHEN 'emprendedor' THEN 10737418240
    WHEN 'crecimiento' THEN 53687091200
    WHEN 'empresarial' THEN 214748364800
  END,
  "actualizado_por_id" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "plan_codigo" IN (
  'prueba',
  'basico',
  'emprendedor',
  'crecimiento',
  'empresarial'
);
