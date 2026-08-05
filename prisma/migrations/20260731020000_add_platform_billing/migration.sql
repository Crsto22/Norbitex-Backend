CREATE TYPE "PlataformaComprobanteTipo" AS ENUM ('nota_venta', 'boleta', 'factura', 'nota_credito');
CREATE TYPE "PlataformaComprobanteEstado" AS ENUM ('pendiente', 'aceptado', 'rechazado', 'error', 'anulacion_pendiente', 'anulado');
CREATE TYPE "CobroAdicionalEstado" AS ENUM ('pagado', 'anulado');
CREATE TYPE "PlataformaSunatJobEstado" AS ENUM ('pendiente', 'procesando', 'finalizado', 'error');
ALTER TYPE "LiquidacionExcedenteEstado" ADD VALUE 'anulado';

CREATE TABLE "configuracion_facturacion_plataforma" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "ruc" VARCHAR(11), "razon_social" VARCHAR(200), "nombre_comercial" VARCHAR(150),
  "direccion" TEXT, "ubigeo" VARCHAR(6), "ambiente" "SunatAmbiente" NOT NULL DEFAULT 'BETA',
  "usuario_sol_encrypted" TEXT, "clave_sol_encrypted" TEXT,
  "certificado_password_encrypted" TEXT, "certificado_r2_key" VARCHAR(600),
  "certificado_nombre" VARCHAR(180), "certificado_mime_type" VARCHAR(80),
  "certificado_size_bytes" INTEGER, "certificado_uploaded_at" TIMESTAMPTZ(6),
  "igv_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 18, "activo" BOOLEAN NOT NULL DEFAULT false,
  "actualizado_por_id" BIGINT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracion_facturacion_plataforma_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configuracion_facturacion_plataforma_singleton_check" CHECK ("id" = 1)
);

CREATE TABLE "serie_comprobante_plataforma" (
  "id" BIGSERIAL NOT NULL, "tipo" "PlataformaComprobanteTipo" NOT NULL,
  "serie" VARCHAR(4) NOT NULL, "correlativo" INTEGER NOT NULL DEFAULT 0,
  "activo" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "serie_comprobante_plataforma_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cobro_adicional_plataforma" (
  "id" BIGSERIAL NOT NULL, "request_id" UUID NOT NULL, "empresa_id" BIGINT NOT NULL,
  "registrado_por_id" BIGINT NOT NULL, "descripcion" VARCHAR(300) NOT NULL,
  "cantidad" DECIMAL(12,3) NOT NULL, "precio_unitario" DECIMAL(12,2) NOT NULL,
  "monto_total" DECIMAL(12,2) NOT NULL, "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "incluye_igv" BOOLEAN NOT NULL DEFAULT true, "metodo_pago" "PagoSuscripcionMetodo" NOT NULL,
  "metodo_pago_otro" VARCHAR(80), "estado" "CobroAdicionalEstado" NOT NULL DEFAULT 'pagado',
  "motivo_anulacion" VARCHAR(300), "anulado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cobro_adicional_plataforma_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comprobante_plataforma" (
  "id" BIGSERIAL NOT NULL, "request_id" UUID NOT NULL, "empresa_id" BIGINT NOT NULL,
  "creado_por_id" BIGINT NOT NULL, "serie_id" BIGINT NOT NULL,
  "pago_suscripcion_id" BIGINT, "liquidacion_excedente_id" BIGINT,
  "cobro_adicional_id" BIGINT, "comprobante_origen_id" BIGINT,
  "tipo" "PlataformaComprobanteTipo" NOT NULL, "serie" VARCHAR(4) NOT NULL, "numero" INTEGER NOT NULL,
  "fecha_emision" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receptor_tipo_documento" VARCHAR(2), "receptor_documento" VARCHAR(20),
  "receptor_nombre" VARCHAR(200) NOT NULL, "receptor_direccion" TEXT,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN', "base_imponible" DECIMAL(12,2) NOT NULL,
  "igv" DECIMAL(12,2) NOT NULL, "total" DECIMAL(12,2) NOT NULL,
  "estado" "PlataformaComprobanteEstado" NOT NULL DEFAULT 'pendiente',
  "sunat_codigo" VARCHAR(20), "sunat_mensaje" TEXT, "xml_r2_key" VARCHAR(600),
  "cdr_r2_key" VARCHAR(600), "pdf_r2_key" VARCHAR(600), "motivo_nota_credito" VARCHAR(300),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comprobante_plataforma_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comprobante_plataforma_fuente_check" CHECK (
    ("tipo" = 'nota_credito' AND "comprobante_origen_id" IS NOT NULL
      AND "pago_suscripcion_id" IS NULL AND "liquidacion_excedente_id" IS NULL AND "cobro_adicional_id" IS NULL)
    OR
    ("tipo" <> 'nota_credito' AND "comprobante_origen_id" IS NULL
      AND num_nonnulls("pago_suscripcion_id", "liquidacion_excedente_id", "cobro_adicional_id") = 1)
  )
);

CREATE TABLE "comprobante_plataforma_detalle" (
  "id" BIGSERIAL NOT NULL, "comprobante_id" BIGINT NOT NULL, "descripcion" VARCHAR(300) NOT NULL,
  "cantidad" DECIMAL(12,3) NOT NULL, "precio_unitario" DECIMAL(12,2) NOT NULL,
  "base_imponible" DECIMAL(12,2) NOT NULL, "igv" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "comprobante_plataforma_detalle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comprobante_plataforma_sunat_job" (
  "id" BIGSERIAL NOT NULL, "comprobante_id" BIGINT NOT NULL,
  "estado" "PlataformaSunatJobEstado" NOT NULL DEFAULT 'pendiente', "intentos" INTEGER NOT NULL DEFAULT 0,
  "siguiente_intento_at" TIMESTAMPTZ(6), "ultimo_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comprobante_plataforma_sunat_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "serie_comprobante_plataforma_serie_key" ON "serie_comprobante_plataforma"("serie");
CREATE INDEX "serie_comprobante_plataforma_tipo_activo_idx" ON "serie_comprobante_plataforma"("tipo", "activo");
CREATE UNIQUE INDEX "cobro_adicional_plataforma_request_id_key" ON "cobro_adicional_plataforma"("request_id");
CREATE INDEX "cobro_adicional_plataforma_empresa_id_created_at_idx" ON "cobro_adicional_plataforma"("empresa_id", "created_at");
CREATE INDEX "cobro_adicional_plataforma_estado_created_at_idx" ON "cobro_adicional_plataforma"("estado", "created_at");
CREATE UNIQUE INDEX "comprobante_plataforma_request_id_key" ON "comprobante_plataforma"("request_id");
CREATE UNIQUE INDEX "comprobante_plataforma_pago_suscripcion_id_key" ON "comprobante_plataforma"("pago_suscripcion_id");
CREATE UNIQUE INDEX "comprobante_plataforma_liquidacion_excedente_id_key" ON "comprobante_plataforma"("liquidacion_excedente_id");
CREATE UNIQUE INDEX "comprobante_plataforma_cobro_adicional_id_key" ON "comprobante_plataforma"("cobro_adicional_id");
CREATE UNIQUE INDEX "comprobante_plataforma_comprobante_origen_id_key" ON "comprobante_plataforma"("comprobante_origen_id");
CREATE UNIQUE INDEX "comprobante_plataforma_serie_numero_key" ON "comprobante_plataforma"("serie", "numero");
CREATE INDEX "comprobante_plataforma_empresa_id_fecha_emision_idx" ON "comprobante_plataforma"("empresa_id", "fecha_emision");
CREATE INDEX "comprobante_plataforma_tipo_estado_fecha_emision_idx" ON "comprobante_plataforma"("tipo", "estado", "fecha_emision");
CREATE INDEX "comprobante_plataforma_detalle_comprobante_id_idx" ON "comprobante_plataforma_detalle"("comprobante_id");
CREATE UNIQUE INDEX "comprobante_plataforma_sunat_job_comprobante_id_key" ON "comprobante_plataforma_sunat_job"("comprobante_id");
CREATE INDEX "comprobante_plataforma_sunat_job_estado_siguiente_intento_at_idx" ON "comprobante_plataforma_sunat_job"("estado", "siguiente_intento_at");

ALTER TABLE "configuracion_facturacion_plataforma" ADD CONSTRAINT "configuracion_facturacion_plataforma_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cobro_adicional_plataforma" ADD CONSTRAINT "cobro_adicional_plataforma_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cobro_adicional_plataforma" ADD CONSTRAINT "cobro_adicional_plataforma_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "serie_comprobante_plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_pago_suscripcion_id_fkey" FOREIGN KEY ("pago_suscripcion_id") REFERENCES "pago_suscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_liquidacion_excedente_id_fkey" FOREIGN KEY ("liquidacion_excedente_id") REFERENCES "liquidacion_excedente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_cobro_adicional_id_fkey" FOREIGN KEY ("cobro_adicional_id") REFERENCES "cobro_adicional_plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma" ADD CONSTRAINT "comprobante_plataforma_comprobante_origen_id_fkey" FOREIGN KEY ("comprobante_origen_id") REFERENCES "comprobante_plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma_detalle" ADD CONSTRAINT "comprobante_plataforma_detalle_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobante_plataforma"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comprobante_plataforma_sunat_job" ADD CONSTRAINT "comprobante_plataforma_sunat_job_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobante_plataforma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "configuracion_facturacion_plataforma" ("id") VALUES (1);
INSERT INTO "serie_comprobante_plataforma" ("tipo", "serie") VALUES
  ('nota_venta', 'NV01'), ('boleta', 'B001'), ('factura', 'F001'), ('nota_credito', 'FC01');
