ALTER TYPE "VentaTipoComprobante" ADD VALUE IF NOT EXISTS 'nota_debito_factura';
ALTER TYPE "VentaTipoComprobante" ADD VALUE IF NOT EXISTS 'nota_debito_boleta';

CREATE TABLE "nota_debito" (
  "id" BIGSERIAL PRIMARY KEY,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "venta_referencia_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT,
  "cliente_id" BIGINT NOT NULL,
  "serie_comprobante_id" BIGINT NOT NULL,
  "creado_por_id" BIGINT,
  "tipo_comprobante" "VentaTipoComprobante" NOT NULL,
  "serie" VARCHAR(4) NOT NULL,
  "numero" INTEGER,
  "correlativo" VARCHAR(15),
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "codigo_motivo" VARCHAR(2) NOT NULL,
  "descripcion_motivo" VARCHAR(250) NOT NULL,
  "tipo_documento_ref" VARCHAR(2) NOT NULL,
  "serie_ref" VARCHAR(4) NOT NULL,
  "numero_ref" INTEGER NOT NULL,
  "correlativo_ref" VARCHAR(15) NOT NULL,
  "fecha_vencimiento" DATE NOT NULL,
  "op_gravadas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "op_exoneradas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "op_inafectas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "igv_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "sunat_estado" "SunatEstado" NOT NULL DEFAULT 'pendiente_envio',
  "sunat_codigo" VARCHAR(20),
  "sunat_mensaje" VARCHAR(500),
  "sunat_enviado_at" TIMESTAMPTZ(6),
  "sunat_respondido_at" TIMESTAMPTZ(6),
  "billing_document_id" UUID,
  "billing_environment" "BillingEnvironment" NOT NULL,
  "billing_status" "BillingDocumentStatus" NOT NULL DEFAULT 'QUEUED',
  "billing_updated_at" TIMESTAMPTZ(6),
  "billing_last_error" VARCHAR(1000),
  "billing_attempts" INTEGER NOT NULL DEFAULT 0,
  "commercial_effects_applied" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "nota_debito_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_venta_referencia_id_fkey" FOREIGN KEY ("venta_referencia_id") REFERENCES "venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_serie_comprobante_id_fkey" FOREIGN KEY ("serie_comprobante_id") REFERENCES "serie_comprobante"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "nota_debito_public_id_key" ON "nota_debito"("public_id");
CREATE UNIQUE INDEX "nota_debito_billing_document_id_key" ON "nota_debito"("billing_document_id");
CREATE UNIQUE INDEX "nota_debito_serie_comprobante_id_numero_key" ON "nota_debito"("serie_comprobante_id", "numero");
CREATE INDEX "nota_debito_empresa_id_sunat_estado_idx" ON "nota_debito"("empresa_id", "sunat_estado");
CREATE INDEX "nota_debito_venta_referencia_id_idx" ON "nota_debito"("venta_referencia_id");
CREATE INDEX "nota_debito_cliente_id_idx" ON "nota_debito"("cliente_id");
CREATE INDEX "nota_debito_sucursal_id_idx" ON "nota_debito"("sucursal_id");
CREATE INDEX "nota_debito_created_at_idx" ON "nota_debito"("created_at");

CREATE TABLE "nota_debito_detalle" (
  "id" BIGSERIAL PRIMARY KEY,
  "nota_debito_id" BIGINT NOT NULL,
  "venta_detalle_referencia_id" BIGINT NOT NULL,
  "descripcion" VARCHAR(255) NOT NULL,
  "importe" DECIMAL(12,2) NOT NULL,
  "valor_venta" DECIMAL(12,2) NOT NULL,
  "igv_monto" DECIMAL(12,2) NOT NULL,
  "tipo_afectacion_igv_codigo" VARCHAR(4) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nota_debito_detalle_nota_debito_id_fkey" FOREIGN KEY ("nota_debito_id") REFERENCES "nota_debito"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nota_debito_detalle_venta_detalle_referencia_id_fkey" FOREIGN KEY ("venta_detalle_referencia_id") REFERENCES "venta_detalle"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "nota_debito_detalle_nota_debito_id_venta_detalle_referencia_id_key" ON "nota_debito_detalle"("nota_debito_id", "venta_detalle_referencia_id");
CREATE INDEX "nota_debito_detalle_venta_detalle_referencia_id_idx" ON "nota_debito_detalle"("venta_detalle_referencia_id");

CREATE TABLE "billing_debit_note_outbox" (
  "id" UUID PRIMARY KEY,
  "empresa_id" BIGINT NOT NULL,
  "nota_debito_id" BIGINT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "status" "BillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 12,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_debit_note_outbox_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_debit_note_outbox_nota_debito_id_fkey" FOREIGN KEY ("nota_debito_id") REFERENCES "nota_debito"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_debit_note_outbox_idempotency_key_key" ON "billing_debit_note_outbox"("idempotency_key");
CREATE UNIQUE INDEX "billing_debit_note_outbox_nota_debito_id_environment_key" ON "billing_debit_note_outbox"("nota_debito_id", "environment");
CREATE INDEX "billing_debit_note_outbox_status_next_attempt_at_idx" ON "billing_debit_note_outbox"("status", "next_attempt_at");
CREATE INDEX "billing_debit_note_outbox_empresa_id_status_idx" ON "billing_debit_note_outbox"("empresa_id", "status");
