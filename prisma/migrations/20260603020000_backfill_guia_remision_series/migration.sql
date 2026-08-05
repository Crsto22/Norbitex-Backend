INSERT INTO "serie_comprobante" (
  "empresa_id",
  "tipo_comprobante",
  "serie",
  "numero_actual",
  "es_principal",
  "aplica_todas_sucursales",
  "activo",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  'guia_remision'::"VentaTipoComprobante",
  'T001',
  0,
  true,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "empresa" empresa
WHERE NOT EXISTS (
  SELECT 1
  FROM "serie_comprobante" serie
  WHERE serie."empresa_id" = empresa."id"
    AND serie."tipo_comprobante" = 'guia_remision'::"VentaTipoComprobante"
);
