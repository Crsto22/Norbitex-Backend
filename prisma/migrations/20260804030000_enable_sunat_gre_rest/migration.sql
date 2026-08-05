INSERT INTO "sunat_endpoint_config" ("ambiente", "codigo", "url", "activo", "created_at", "updated_at")
VALUES
  ('BETA', 'API_TOKEN', 'https://gre-test.nubefact.com/v1/clientessol', true, now(), now()),
  ('BETA', 'API_CPE', 'https://gre-test.nubefact.com/v1/contribuyente/gem/comprobantes', true, now(), now()),
  ('PRODUCCION', 'API_TOKEN', 'https://api-seguridad.sunat.gob.pe/v1/clientessol', true, now(), now()),
  ('PRODUCCION', 'API_CPE', 'https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes', true, now(), now())
ON CONFLICT ("ambiente", "codigo") DO UPDATE
SET "url" = EXCLUDED."url", "activo" = true, "updated_at" = now();
