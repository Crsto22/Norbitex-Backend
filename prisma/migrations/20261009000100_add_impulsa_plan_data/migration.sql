-- Datos del plan comercial "Impulsa" (POS + facturación + caja).
-- Idempotente: se puede re-ejecutar sin duplicar ni fallar.

INSERT INTO "plan" ("plan_codigo", "nombre", "descripcion", "estado", "trial_days")
VALUES (
  'impulsa'::"PlanCodigo",
  'Impulsa',
  'Plan intermedio con POS, facturación electrónica y caja',
  'activo',
  NULL
)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "tarifa_plan" (
  "plan_codigo",
  "precio_mensual",
  "descuento_mensual_porcentaje",
  "descuento_anual_porcentaje"
)
VALUES ('impulsa'::"PlanCodigo", 29.90, 0.00, 10.00)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "limite_plan" (
  "plan_codigo",
  "usuarios",
  "sucursales",
  "almacenes",
  "productos",
  "variantes",
  "comprobantes",
  "consultas_documento",
  "almacenamiento_bytes",
  "trabajadores_asistencia",
  "puntos_qr_asistencia"
)
VALUES ('impulsa'::"PlanCodigo", 2, 1, 5, 800, 3500, 350, 400, 6396313600, 0, 0)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "plan_modulo" ("plan_codigo", "module_key", "enabled")
SELECT 'impulsa'::"PlanCodigo", module_key, true
FROM unnest(ARRAY[
  'dashboard',
  'ventas-pos',
  'caja',
  'cotizaciones',
  'entregas-pendientes',
  'clientes',
  'historial-ventas',
  'historial-cotizaciones',
  'comprobantes',
  'nota-credito',
  'series',
  'productos',
  'categorias',
  'marcas',
  'tallas',
  'colores',
  'stock-movimientos',
  'stock-traspasos',
  'stock-kardex',
  'sucursales',
  'usuarios',
  'reportes-ventas',
  'reportes-productos',
  'empresa',
  'metodos-pago',
  'mi-cuenta'
]) AS module_key
ON CONFLICT ("plan_codigo", "module_key") DO NOTHING;
