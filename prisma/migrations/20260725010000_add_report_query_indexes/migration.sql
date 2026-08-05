CREATE INDEX "cliente_empresa_id_estado_idx"
ON "cliente"("empresa_id", "estado");

CREATE INDEX "cliente_empresa_id_created_at_idx"
ON "cliente"("empresa_id", "created_at");

CREATE INDEX "venta_empresa_id_estado_created_at_idx"
ON "venta"("empresa_id", "estado", "created_at");

CREATE INDEX "venta_empresa_id_sucursal_id_estado_created_at_idx"
ON "venta"("empresa_id", "sucursal_id", "estado", "created_at");

CREATE INDEX "venta_empresa_id_creado_por_id_estado_created_at_idx"
ON "venta"("empresa_id", "creado_por_id", "estado", "created_at");

CREATE INDEX "venta_empresa_id_anulado_at_idx"
ON "venta"("empresa_id", "anulado_at");
