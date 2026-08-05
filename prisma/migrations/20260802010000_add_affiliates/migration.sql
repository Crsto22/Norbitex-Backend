CREATE TYPE "AfiliadoEstado" AS ENUM ('activo', 'inactivo');
CREATE TYPE "EmpresaAfiliacionEstado" AS ENUM ('activa', 'interrumpida', 'cancelada');
CREATE TYPE "ComisionAfiliadoTipo" AS ENUM ('venta', 'ajuste_anulacion');
CREATE TYPE "ComisionAfiliadoEstado" AS ENUM ('pendiente', 'liquidada', 'anulada');
CREATE TYPE "LiquidacionAfiliadoEstado" AS ENUM ('pendiente', 'pagada');

ALTER TABLE "pago_suscripcion"
  ADD COLUMN "afiliado_id" BIGINT,
  ADD COLUMN "afiliado_codigo" VARCHAR(30),
  ADD COLUMN "descuento_afiliado_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "monto_descuento_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "base_comision_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "comision_afiliado_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "monto_comision_afiliado" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "afiliado" (
  "id" BIGSERIAL PRIMARY KEY,
  "codigo" VARCHAR(30) NOT NULL,
  "codigo_key" VARCHAR(30) NOT NULL,
  "nombre" VARCHAR(160) NOT NULL,
  "documento" VARCHAR(20),
  "email" VARCHAR(180),
  "telefono" VARCHAR(30),
  "descuento_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "comision_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "estado" "AfiliadoEstado" NOT NULL DEFAULT 'activo',
  "creado_por_id" BIGINT NOT NULL,
  "actualizado_por_id" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "empresa_afiliacion" (
  "empresa_id" BIGINT PRIMARY KEY,
  "afiliado_id" BIGINT NOT NULL,
  "primer_pago_id" BIGINT,
  "estado" "EmpresaAfiliacionEstado" NOT NULL DEFAULT 'activa',
  "iniciada_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "interrumpida_at" TIMESTAMPTZ(6),
  "motivo_fin" VARCHAR(200),
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "liquidacion_afiliado" (
  "id" BIGSERIAL PRIMARY KEY,
  "request_id" UUID NOT NULL,
  "pago_request_id" UUID,
  "afiliado_id" BIGINT NOT NULL,
  "periodo" VARCHAR(7) NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "monto_total" DECIMAL(12,2) NOT NULL,
  "estado" "LiquidacionAfiliadoEstado" NOT NULL DEFAULT 'pendiente',
  "metodo_pago" "PagoSuscripcionMetodo",
  "referencia_pago" VARCHAR(120),
  "cerrada_por_id" BIGINT NOT NULL,
  "pagada_por_id" BIGINT,
  "pagado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "comision_afiliado" (
  "id" BIGSERIAL PRIMARY KEY,
  "afiliado_id" BIGINT NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "pago_suscripcion_id" BIGINT NOT NULL,
  "liquidacion_id" BIGINT,
  "tipo" "ComisionAfiliadoTipo" NOT NULL DEFAULT 'venta',
  "periodo" VARCHAR(7) NOT NULL,
  "base_calculo" DECIMAL(12,2) NOT NULL,
  "porcentaje" DECIMAL(5,2) NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "estado" "ComisionAfiliadoEstado" NOT NULL DEFAULT 'pendiente',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "afiliado_codigo_key_key" ON "afiliado"("codigo_key");
CREATE INDEX "afiliado_estado_created_at_idx" ON "afiliado"("estado", "created_at");
CREATE UNIQUE INDEX "empresa_afiliacion_primer_pago_id_key" ON "empresa_afiliacion"("primer_pago_id");
CREATE INDEX "empresa_afiliacion_afiliado_id_estado_idx" ON "empresa_afiliacion"("afiliado_id", "estado");
CREATE UNIQUE INDEX "liquidacion_afiliado_request_id_key" ON "liquidacion_afiliado"("request_id");
CREATE UNIQUE INDEX "liquidacion_afiliado_pago_request_id_key" ON "liquidacion_afiliado"("pago_request_id");
CREATE UNIQUE INDEX "liquidacion_afiliado_afiliado_id_periodo_key" ON "liquidacion_afiliado"("afiliado_id", "periodo");
CREATE INDEX "liquidacion_afiliado_estado_created_at_idx" ON "liquidacion_afiliado"("estado", "created_at");
CREATE UNIQUE INDEX "comision_afiliado_pago_suscripcion_id_tipo_key" ON "comision_afiliado"("pago_suscripcion_id", "tipo");
CREATE INDEX "comision_afiliado_afiliado_id_periodo_estado_idx" ON "comision_afiliado"("afiliado_id", "periodo", "estado");
CREATE INDEX "comision_afiliado_empresa_id_created_at_idx" ON "comision_afiliado"("empresa_id", "created_at");
CREATE INDEX "comision_afiliado_liquidacion_id_idx" ON "comision_afiliado"("liquidacion_id");
CREATE INDEX "pago_suscripcion_afiliado_id_created_at_idx" ON "pago_suscripcion"("afiliado_id", "created_at");

ALTER TABLE "afiliado" ADD CONSTRAINT "afiliado_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "afiliado" ADD CONSTRAINT "afiliado_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "empresa_afiliacion" ADD CONSTRAINT "empresa_afiliacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "empresa_afiliacion" ADD CONSTRAINT "empresa_afiliacion_afiliado_id_fkey" FOREIGN KEY ("afiliado_id") REFERENCES "afiliado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "empresa_afiliacion" ADD CONSTRAINT "empresa_afiliacion_primer_pago_id_fkey" FOREIGN KEY ("primer_pago_id") REFERENCES "pago_suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pago_suscripcion" ADD CONSTRAINT "pago_suscripcion_afiliado_id_fkey" FOREIGN KEY ("afiliado_id") REFERENCES "afiliado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "liquidacion_afiliado" ADD CONSTRAINT "liquidacion_afiliado_afiliado_id_fkey" FOREIGN KEY ("afiliado_id") REFERENCES "afiliado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "liquidacion_afiliado" ADD CONSTRAINT "liquidacion_afiliado_cerrada_por_id_fkey" FOREIGN KEY ("cerrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "liquidacion_afiliado" ADD CONSTRAINT "liquidacion_afiliado_pagada_por_id_fkey" FOREIGN KEY ("pagada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comision_afiliado" ADD CONSTRAINT "comision_afiliado_afiliado_id_fkey" FOREIGN KEY ("afiliado_id") REFERENCES "afiliado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comision_afiliado" ADD CONSTRAINT "comision_afiliado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comision_afiliado" ADD CONSTRAINT "comision_afiliado_pago_suscripcion_id_fkey" FOREIGN KEY ("pago_suscripcion_id") REFERENCES "pago_suscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comision_afiliado" ADD CONSTRAINT "comision_afiliado_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidacion_afiliado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
