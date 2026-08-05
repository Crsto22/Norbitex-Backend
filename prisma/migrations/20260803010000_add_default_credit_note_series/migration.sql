INSERT INTO "serie_comprobante" (
  "empresa_id", "tipo_comprobante", "serie", "numero_actual",
  "es_principal", "aplica_todas_sucursales", "activo", "created_at", "updated_at"
)
SELECT
  empresa."id", defaults."tipo"::"VentaTipoComprobante", defaults."serie",
  0, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "empresa" empresa
CROSS JOIN (
  VALUES
    ('nota_credito_factura', 'FC01'),
    ('nota_credito_boleta', 'BC01')
) AS defaults("tipo", "serie")
WHERE NOT EXISTS (
  SELECT 1
  FROM "serie_comprobante" existing
  WHERE existing."empresa_id" = empresa."id"
    AND existing."tipo_comprobante" = defaults."tipo"::"VentaTipoComprobante"
);
