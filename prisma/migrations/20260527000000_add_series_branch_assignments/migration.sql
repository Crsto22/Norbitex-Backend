ALTER TABLE "serie_comprobante"
  ADD COLUMN "aplica_todas_sucursales" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "serie_comprobante_sucursal" (
  "serie_comprobante_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "serie_comprobante_sucursal_pkey" PRIMARY KEY ("serie_comprobante_id", "sucursal_id")
);

INSERT INTO "serie_comprobante_sucursal" ("serie_comprobante_id", "sucursal_id", "empresa_id")
SELECT "id", "sucursal_id", "empresa_id"
FROM "serie_comprobante"
WHERE "sucursal_id" IS NOT NULL;

UPDATE "serie_comprobante"
SET "aplica_todas_sucursales" = false
WHERE "sucursal_id" IS NOT NULL;

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
SELECT e."id", defaults."tipo_comprobante"::"VentaTipoComprobante", defaults."serie", 0, true, true, true, now(), now()
FROM "empresa" e
CROSS JOIN (
  VALUES
    ('nota_venta', 'NV01'),
    ('factura', 'F001'),
    ('boleta', 'B001')
) AS defaults("tipo_comprobante", "serie")
ON CONFLICT ("empresa_id", "tipo_comprobante", "serie") DO NOTHING;

CREATE INDEX "serie_comprobante_sucursal_empresa_id_idx" ON "serie_comprobante_sucursal"("empresa_id");
CREATE INDEX "serie_comprobante_sucursal_sucursal_id_idx" ON "serie_comprobante_sucursal"("sucursal_id");

ALTER TABLE "serie_comprobante_sucursal"
  ADD CONSTRAINT "serie_comprobante_sucursal_serie_comprobante_id_fkey"
  FOREIGN KEY ("serie_comprobante_id") REFERENCES "serie_comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serie_comprobante_sucursal"
  ADD CONSTRAINT "serie_comprobante_sucursal_sucursal_id_fkey"
  FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serie_comprobante_sucursal"
  ADD CONSTRAINT "serie_comprobante_sucursal_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serie_comprobante" DROP CONSTRAINT IF EXISTS "serie_comprobante_sucursal_id_fkey";
ALTER TABLE "serie_comprobante" DROP COLUMN "sucursal_id";
