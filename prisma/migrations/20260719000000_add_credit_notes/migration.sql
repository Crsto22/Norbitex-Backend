ALTER TYPE "VentaTipoComprobante" ADD VALUE IF NOT EXISTS 'nota_credito_factura';
ALTER TYPE "VentaTipoComprobante" ADD VALUE IF NOT EXISTS 'nota_credito_boleta';
ALTER TYPE "VentaEstado" ADD VALUE IF NOT EXISTS 'nc_emitida';
ALTER TYPE "SunatJobTipoDocumento" ADD VALUE IF NOT EXISTS 'nota_credito';

CREATE TABLE IF NOT EXISTS "nota_credito" (
  "id" BIGSERIAL PRIMARY KEY,
  "public_id" VARCHAR(30) NOT NULL UNIQUE,
  "empresa_id" BIGINT NOT NULL,
  "venta_referencia_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT,
  "cliente_id" BIGINT,
  "serie_comprobante_id" BIGINT NOT NULL,
  "creado_por_id" BIGINT,
  "tipo_comprobante" "VentaTipoComprobante" NOT NULL,
  "serie" VARCHAR(4) NOT NULL,
  "numero" INTEGER NOT NULL,
  "correlativo" VARCHAR(15) NOT NULL,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "codigo_motivo" VARCHAR(2) NOT NULL,
  "descripcion_motivo" VARCHAR(255) NOT NULL,
  "tipo_documento_ref" VARCHAR(2) NOT NULL,
  "serie_ref" VARCHAR(4) NOT NULL,
  "numero_ref" INTEGER NOT NULL,
  "correlativo_ref" VARCHAR(15) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "igv_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  "op_gravadas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "op_exoneradas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "op_inafectas" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "igv_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'emitida',
  "sunat_estado" "SunatEstado" NOT NULL DEFAULT 'pendiente_envio',
  "sunat_codigo" VARCHAR(20),
  "sunat_mensaje" VARCHAR(500),
  "sunat_hash" VARCHAR(120),
  "sunat_xml_nombre" VARCHAR(180),
  "sunat_xml_key" VARCHAR(600),
  "sunat_zip_nombre" VARCHAR(180),
  "sunat_zip_key" VARCHAR(600),
  "sunat_cdr_nombre" VARCHAR(180),
  "sunat_cdr_key" VARCHAR(600),
  "sunat_pdf_nombre" VARCHAR(180),
  "sunat_pdf_key" VARCHAR(600),
  "sunat_enviado_at" TIMESTAMPTZ(6),
  "sunat_respondido_at" TIMESTAMPTZ(6),
  "stock_devuelto" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nota_credito_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE,
  CONSTRAINT "nota_credito_venta_referencia_id_fkey" FOREIGN KEY ("venta_referencia_id") REFERENCES "venta"("id") ON DELETE RESTRICT,
  CONSTRAINT "nota_credito_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE SET NULL,
  CONSTRAINT "nota_credito_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL,
  CONSTRAINT "nota_credito_serie_comprobante_id_fkey" FOREIGN KEY ("serie_comprobante_id") REFERENCES "serie_comprobante"("id") ON DELETE RESTRICT,
  CONSTRAINT "nota_credito_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "nota_credito_detalle" (
  "id" BIGSERIAL PRIMARY KEY,
  "nota_credito_id" BIGINT NOT NULL,
  "venta_detalle_referencia_id" BIGINT,
  "producto_variante_id" BIGINT NOT NULL,
  "descripcion" VARCHAR(255),
  "cantidad" INTEGER NOT NULL,
  "unidad_medida_codigo" VARCHAR(10) NOT NULL DEFAULT 'NIU',
  "tipo_afectacion_igv_codigo" VARCHAR(4) NOT NULL DEFAULT '10',
  "precio_unitario" DECIMAL(12,2) NOT NULL,
  "valor_unitario" DECIMAL(12,10) NOT NULL DEFAULT 0,
  "descuento_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "valor_venta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "igv_monto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nota_credito_detalle_nota_credito_id_fkey" FOREIGN KEY ("nota_credito_id") REFERENCES "nota_credito"("id") ON DELETE CASCADE,
  CONSTRAINT "nota_credito_detalle_venta_detalle_referencia_id_fkey" FOREIGN KEY ("venta_detalle_referencia_id") REFERENCES "venta_detalle"("id") ON DELETE SET NULL,
  CONSTRAINT "nota_credito_detalle_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "nota_credito_serie_comprobante_id_numero_key" ON "nota_credito"("serie_comprobante_id", "numero");
CREATE INDEX IF NOT EXISTS "nota_credito_empresa_id_idx" ON "nota_credito"("empresa_id");
CREATE INDEX IF NOT EXISTS "nota_credito_venta_referencia_id_idx" ON "nota_credito"("venta_referencia_id");
CREATE INDEX IF NOT EXISTS "nota_credito_empresa_id_sunat_estado_idx" ON "nota_credito"("empresa_id", "sunat_estado");
CREATE INDEX IF NOT EXISTS "nota_credito_cliente_id_idx" ON "nota_credito"("cliente_id");
CREATE INDEX IF NOT EXISTS "nota_credito_sucursal_id_idx" ON "nota_credito"("sucursal_id");
CREATE INDEX IF NOT EXISTS "nota_credito_serie_numero_idx" ON "nota_credito"("serie", "numero");
CREATE INDEX IF NOT EXISTS "nota_credito_correlativo_idx" ON "nota_credito"("correlativo");
CREATE INDEX IF NOT EXISTS "nota_credito_created_at_idx" ON "nota_credito"("created_at");
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_nota_credito_id_idx" ON "nota_credito_detalle"("nota_credito_id");
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_venta_detalle_referencia_id_idx" ON "nota_credito_detalle"("venta_detalle_referencia_id");
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_producto_variante_id_idx" ON "nota_credito_detalle"("producto_variante_id");
