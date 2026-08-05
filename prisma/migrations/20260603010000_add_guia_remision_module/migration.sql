ALTER TYPE "VentaTipoComprobante" ADD VALUE IF NOT EXISTS 'guia_remision';
ALTER TYPE "SunatEstado" ADD VALUE IF NOT EXISTS 'pendiente_cdr';
ALTER TYPE "SunatJobTipoDocumento" ADD VALUE IF NOT EXISTS 'guia_remision';

CREATE TYPE "GuiaRemisionEstado" AS ENUM (
  'borrador',
  'emitida',
  'aceptada',
  'rechazada',
  'anulada'
);

CREATE TYPE "GuiaRemisionParticipanteTipo" AS ENUM (
  'conductor',
  'transportista'
);

CREATE TABLE "guia_remision" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT NOT NULL,
  "creado_por_id" BIGINT,
  "serie_comprobante_id" BIGINT NOT NULL,
  "serie" VARCHAR(4) NOT NULL,
  "numero" INTEGER NOT NULL,
  "correlativo" VARCHAR(15) NOT NULL,
  "fecha_emision" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fecha_inicio_traslado" DATE NOT NULL,
  "fecha_entrega_transportista" DATE,
  "motivo_traslado" VARCHAR(2) NOT NULL DEFAULT '04',
  "descripcion_motivo" VARCHAR(255),
  "modalidad_transporte" VARCHAR(2) NOT NULL,
  "peso_bruto_total" DECIMAL(12,3) NOT NULL,
  "unidad_peso" VARCHAR(3) NOT NULL DEFAULT 'KGM',
  "numero_bultos" INTEGER,
  "observaciones" VARCHAR(500),
  "sucursal_partida_id" BIGINT,
  "ubigeo_partida" VARCHAR(6) NOT NULL,
  "direccion_partida" VARCHAR(255) NOT NULL,
  "sucursal_llegada_id" BIGINT,
  "ubigeo_llegada" VARCHAR(6) NOT NULL,
  "direccion_llegada" VARCHAR(255) NOT NULL,
  "destinatario_tipo_doc" VARCHAR(1) NOT NULL,
  "destinatario_nro_doc" VARCHAR(20) NOT NULL,
  "destinatario_razon_social" VARCHAR(200) NOT NULL,
  "estado" "GuiaRemisionEstado" NOT NULL DEFAULT 'borrador',
  "sunat_estado" "SunatEstado" NOT NULL DEFAULT 'no_aplica',
  "sunat_codigo" VARCHAR(20),
  "sunat_mensaje" VARCHAR(500),
  "sunat_hash" VARCHAR(120),
  "sunat_ticket" VARCHAR(120),
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
  "anulado_at" TIMESTAMPTZ(6),
  "anulado_razon" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "guia_remision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guia_remision_detalle" (
  "id" BIGSERIAL NOT NULL,
  "guia_remision_id" BIGINT NOT NULL,
  "producto_variante_id" BIGINT,
  "descripcion" VARCHAR(255) NOT NULL,
  "cantidad" DECIMAL(12,3) NOT NULL,
  "unidad_medida" VARCHAR(3) NOT NULL DEFAULT 'NIU',
  "codigo_producto" VARCHAR(50),
  "peso_unitario" DECIMAL(12,3),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guia_remision_detalle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guia_remision_documento_relacionado" (
  "id" BIGSERIAL NOT NULL,
  "guia_remision_id" BIGINT NOT NULL,
  "tipo_documento" VARCHAR(2) NOT NULL,
  "serie" VARCHAR(4) NOT NULL,
  "numero" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guia_remision_documento_relacionado_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guia_remision_transporte_participante" (
  "id" BIGSERIAL NOT NULL,
  "guia_remision_id" BIGINT NOT NULL,
  "tipo" "GuiaRemisionParticipanteTipo" NOT NULL,
  "tipo_documento" VARCHAR(1) NOT NULL,
  "numero_documento" VARCHAR(20) NOT NULL,
  "nombres" VARCHAR(120),
  "apellidos" VARCHAR(120),
  "razon_social" VARCHAR(200),
  "licencia" VARCHAR(20),
  "registro_mtc" VARCHAR(20),
  "es_principal" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guia_remision_transporte_participante_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guia_remision_vehiculo" (
  "id" BIGSERIAL NOT NULL,
  "guia_remision_id" BIGINT NOT NULL,
  "placa" VARCHAR(10) NOT NULL,
  "es_principal" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guia_remision_vehiculo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalogo_transporte_participante" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "tipo" "GuiaRemisionParticipanteTipo" NOT NULL,
  "tipo_documento" VARCHAR(1) NOT NULL,
  "numero_documento" VARCHAR(20) NOT NULL,
  "nombres" VARCHAR(120),
  "apellidos" VARCHAR(120),
  "razon_social" VARCHAR(200),
  "licencia" VARCHAR(20),
  "registro_mtc" VARCHAR(20),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "catalogo_transporte_participante_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalogo_vehiculo" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "placa" VARCHAR(10) NOT NULL,
  "marca" VARCHAR(80),
  "modelo" VARCHAR(80),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "catalogo_vehiculo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guia_remision_public_id_key" ON "guia_remision"("public_id");
CREATE UNIQUE INDEX "guia_remision_serie_comprobante_id_numero_key" ON "guia_remision"("serie_comprobante_id", "numero");
CREATE INDEX "guia_remision_empresa_id_idx" ON "guia_remision"("empresa_id");
CREATE INDEX "guia_remision_empresa_id_estado_idx" ON "guia_remision"("empresa_id", "estado");
CREATE INDEX "guia_remision_empresa_id_sunat_estado_idx" ON "guia_remision"("empresa_id", "sunat_estado");
CREATE INDEX "guia_remision_sucursal_id_idx" ON "guia_remision"("sucursal_id");
CREATE INDEX "guia_remision_sucursal_partida_id_idx" ON "guia_remision"("sucursal_partida_id");
CREATE INDEX "guia_remision_sucursal_llegada_id_idx" ON "guia_remision"("sucursal_llegada_id");
CREATE INDEX "guia_remision_serie_numero_idx" ON "guia_remision"("serie", "numero");
CREATE INDEX "guia_remision_correlativo_idx" ON "guia_remision"("correlativo");
CREATE INDEX "guia_remision_created_at_idx" ON "guia_remision"("created_at");

CREATE INDEX "guia_remision_detalle_guia_remision_id_idx" ON "guia_remision_detalle"("guia_remision_id");
CREATE INDEX "guia_remision_detalle_producto_variante_id_idx" ON "guia_remision_detalle"("producto_variante_id");
CREATE INDEX "guia_remision_documento_relacionado_guia_remision_id_idx" ON "guia_remision_documento_relacionado"("guia_remision_id");
CREATE INDEX "guia_remision_documento_relacionado_tipo_documento_serie_numero_idx" ON "guia_remision_documento_relacionado"("tipo_documento", "serie", "numero");
CREATE INDEX "guia_remision_transporte_participante_guia_remision_id_idx" ON "guia_remision_transporte_participante"("guia_remision_id");
CREATE INDEX "guia_remision_transporte_participante_tipo_idx" ON "guia_remision_transporte_participante"("tipo");
CREATE INDEX "guia_remision_vehiculo_guia_remision_id_idx" ON "guia_remision_vehiculo"("guia_remision_id");
CREATE INDEX "guia_remision_vehiculo_placa_idx" ON "guia_remision_vehiculo"("placa");

CREATE UNIQUE INDEX "catalogo_transporte_participante_public_id_key" ON "catalogo_transporte_participante"("public_id");
CREATE UNIQUE INDEX "catalogo_transporte_participante_empresa_id_tipo_numero_documento_key" ON "catalogo_transporte_participante"("empresa_id", "tipo", "numero_documento");
CREATE INDEX "catalogo_transporte_participante_empresa_id_idx" ON "catalogo_transporte_participante"("empresa_id");
CREATE INDEX "catalogo_transporte_participante_tipo_idx" ON "catalogo_transporte_participante"("tipo");
CREATE INDEX "catalogo_transporte_participante_activo_idx" ON "catalogo_transporte_participante"("activo");
CREATE INDEX "catalogo_transporte_participante_deleted_at_idx" ON "catalogo_transporte_participante"("deleted_at");

CREATE UNIQUE INDEX "catalogo_vehiculo_public_id_key" ON "catalogo_vehiculo"("public_id");
CREATE UNIQUE INDEX "catalogo_vehiculo_empresa_id_placa_key" ON "catalogo_vehiculo"("empresa_id", "placa");
CREATE INDEX "catalogo_vehiculo_empresa_id_idx" ON "catalogo_vehiculo"("empresa_id");
CREATE INDEX "catalogo_vehiculo_activo_idx" ON "catalogo_vehiculo"("activo");
CREATE INDEX "catalogo_vehiculo_deleted_at_idx" ON "catalogo_vehiculo"("deleted_at");

ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_sucursal_partida_id_fkey" FOREIGN KEY ("sucursal_partida_id") REFERENCES "sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_sucursal_llegada_id_fkey" FOREIGN KEY ("sucursal_llegada_id") REFERENCES "sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guia_remision" ADD CONSTRAINT "guia_remision_serie_comprobante_id_fkey" FOREIGN KEY ("serie_comprobante_id") REFERENCES "serie_comprobante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guia_remision_detalle" ADD CONSTRAINT "guia_remision_detalle_guia_remision_id_fkey" FOREIGN KEY ("guia_remision_id") REFERENCES "guia_remision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guia_remision_detalle" ADD CONSTRAINT "guia_remision_detalle_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "producto_variante"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guia_remision_documento_relacionado" ADD CONSTRAINT "guia_remision_documento_relacionado_guia_remision_id_fkey" FOREIGN KEY ("guia_remision_id") REFERENCES "guia_remision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guia_remision_transporte_participante" ADD CONSTRAINT "guia_remision_transporte_participante_guia_remision_id_fkey" FOREIGN KEY ("guia_remision_id") REFERENCES "guia_remision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guia_remision_vehiculo" ADD CONSTRAINT "guia_remision_vehiculo_guia_remision_id_fkey" FOREIGN KEY ("guia_remision_id") REFERENCES "guia_remision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalogo_transporte_participante" ADD CONSTRAINT "catalogo_transporte_participante_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalogo_vehiculo" ADD CONSTRAINT "catalogo_vehiculo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
