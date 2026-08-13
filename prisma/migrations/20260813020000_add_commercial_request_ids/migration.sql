ALTER TABLE "venta" ADD COLUMN "request_id" UUID;
ALTER TABLE "cotizacion" ADD COLUMN "request_id" UUID;

CREATE UNIQUE INDEX "venta_empresa_id_request_id_key" ON "venta"("empresa_id", "request_id");
CREATE UNIQUE INDEX "cotizacion_empresa_id_request_id_key" ON "cotizacion"("empresa_id", "request_id");
