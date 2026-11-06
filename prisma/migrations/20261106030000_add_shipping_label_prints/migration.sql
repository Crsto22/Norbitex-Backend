CREATE TABLE "venta_envio_etiqueta_impresion" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "venta_envio_id" BIGINT NOT NULL,
  "cantidad_bultos" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "impreso_por_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venta_envio_etiqueta_impresion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venta_envio_etiqueta_impresion_public_id_key"
  ON "venta_envio_etiqueta_impresion"("public_id");
CREATE INDEX "venta_envio_etiqueta_impresion_venta_envio_id_created_at_idx"
  ON "venta_envio_etiqueta_impresion"("venta_envio_id", "created_at");
CREATE INDEX "venta_envio_etiqueta_impresion_impreso_por_id_idx"
  ON "venta_envio_etiqueta_impresion"("impreso_por_id");

ALTER TABLE "venta_envio_etiqueta_impresion"
  ADD CONSTRAINT "venta_envio_etiqueta_impresion_venta_envio_id_fkey"
  FOREIGN KEY ("venta_envio_id") REFERENCES "venta_envio"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venta_envio_etiqueta_impresion"
  ADD CONSTRAINT "venta_envio_etiqueta_impresion_impreso_por_id_fkey"
  FOREIGN KEY ("impreso_por_id") REFERENCES "usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "venta_envio_etiqueta_impresion"
  ADD CONSTRAINT "venta_envio_etiqueta_impresion_cantidad_bultos_check"
  CHECK ("cantidad_bultos" BETWEEN 1 AND 50);
