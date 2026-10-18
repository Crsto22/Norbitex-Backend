CREATE TYPE "VentaFormaPago" AS ENUM ('CONTADO', 'CREDITO');
CREATE TYPE "VentaPagoOrigen" AS ENUM ('venta', 'cobranza');
CREATE TYPE "CuentaPorCobrarEstado" AS ENUM ('pendiente', 'parcial', 'pagada', 'anulacion_pendiente', 'anulada');
CREATE TYPE "CuentaPorCobrarCuotaEstado" AS ENUM ('pendiente', 'parcial', 'pagada', 'anulada');

ALTER TYPE "CajaMovimientoTipo" ADD VALUE IF NOT EXISTS 'cobranza';
ALTER TYPE "CajaMovimientoTipo" ADD VALUE IF NOT EXISTS 'anulacion_cobranza';

ALTER TABLE "venta"
  ALTER COLUMN "forma_pago" DROP DEFAULT,
  ALTER COLUMN "forma_pago" TYPE "VentaFormaPago" USING (UPPER("forma_pago")::"VentaFormaPago"),
  ALTER COLUMN "forma_pago" SET DEFAULT 'CONTADO';

ALTER TABLE "venta_pago"
  ADD COLUMN "public_id" VARCHAR(30),
  ADD COLUMN "creado_por_id" BIGINT,
  ADD COLUMN "request_id" UUID,
  ADD COLUMN "origen" "VentaPagoOrigen" NOT NULL DEFAULT 'venta';

UPDATE "venta_pago"
SET "public_id" = CONCAT('legacy_', "id"::text)
WHERE "public_id" IS NULL;

ALTER TABLE "venta_pago" ALTER COLUMN "public_id" SET NOT NULL;

CREATE TABLE "cuenta_por_cobrar" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "empresa_id" BIGINT NOT NULL,
  "venta_id" BIGINT NOT NULL,
  "cliente_id" BIGINT NOT NULL,
  "sucursal_id" BIGINT,
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
  "total_venta" DECIMAL(12,2) NOT NULL,
  "adelanto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "saldo_inicial" DECIMAL(12,2) NOT NULL,
  "saldo_pendiente" DECIMAL(12,2) NOT NULL,
  "saldo_favor" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "estado" "CuentaPorCobrarEstado" NOT NULL DEFAULT 'pendiente',
  "primer_vencimiento" DATE NOT NULL,
  "ultimo_pago_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cuenta_por_cobrar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cuenta_por_cobrar_cuota" (
  "id" BIGSERIAL NOT NULL,
  "cuenta_por_cobrar_id" BIGINT NOT NULL,
  "numero" INTEGER NOT NULL,
  "fecha_vencimiento" DATE NOT NULL,
  "monto_original" DECIMAL(12,2) NOT NULL,
  "monto_pagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "saldo" DECIMAL(12,2) NOT NULL,
  "estado" "CuentaPorCobrarCuotaEstado" NOT NULL DEFAULT 'pendiente',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cuenta_por_cobrar_cuota_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cuenta_por_cobrar_aplicacion" (
  "id" BIGSERIAL NOT NULL,
  "cuota_id" BIGINT NOT NULL,
  "pago_id" BIGINT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cuenta_por_cobrar_aplicacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venta_pago_public_id_key" ON "venta_pago"("public_id");
CREATE UNIQUE INDEX "venta_pago_venta_id_request_id_key" ON "venta_pago"("venta_id", "request_id");
CREATE INDEX "venta_pago_creado_por_id_idx" ON "venta_pago"("creado_por_id");
CREATE INDEX "venta_pago_origen_created_at_idx" ON "venta_pago"("origen", "created_at");
CREATE UNIQUE INDEX "cuenta_por_cobrar_public_id_key" ON "cuenta_por_cobrar"("public_id");
CREATE UNIQUE INDEX "cuenta_por_cobrar_venta_id_key" ON "cuenta_por_cobrar"("venta_id");
CREATE INDEX "cuenta_por_cobrar_empresa_id_estado_idx" ON "cuenta_por_cobrar"("empresa_id", "estado");
CREATE INDEX "cuenta_por_cobrar_empresa_id_cliente_id_idx" ON "cuenta_por_cobrar"("empresa_id", "cliente_id");
CREATE INDEX "cuenta_por_cobrar_empresa_id_sucursal_id_idx" ON "cuenta_por_cobrar"("empresa_id", "sucursal_id");
CREATE INDEX "cuenta_por_cobrar_empresa_id_primer_vencimiento_idx" ON "cuenta_por_cobrar"("empresa_id", "primer_vencimiento");
CREATE UNIQUE INDEX "cuenta_por_cobrar_cuota_cuenta_por_cobrar_id_numero_key" ON "cuenta_por_cobrar_cuota"("cuenta_por_cobrar_id", "numero");
CREATE INDEX "cuenta_por_cobrar_cuota_cuenta_por_cobrar_id_fecha_vencimiento_idx" ON "cuenta_por_cobrar_cuota"("cuenta_por_cobrar_id", "fecha_vencimiento");
CREATE INDEX "cuenta_por_cobrar_cuota_estado_fecha_vencimiento_idx" ON "cuenta_por_cobrar_cuota"("estado", "fecha_vencimiento");
CREATE UNIQUE INDEX "cuenta_por_cobrar_aplicacion_cuota_id_pago_id_key" ON "cuenta_por_cobrar_aplicacion"("cuota_id", "pago_id");
CREATE INDEX "cuenta_por_cobrar_aplicacion_pago_id_idx" ON "cuenta_por_cobrar_aplicacion"("pago_id");

ALTER TABLE "venta_pago" ADD CONSTRAINT "venta_pago_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar" ADD CONSTRAINT "cuenta_por_cobrar_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar" ADD CONSTRAINT "cuenta_por_cobrar_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar" ADD CONSTRAINT "cuenta_por_cobrar_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar" ADD CONSTRAINT "cuenta_por_cobrar_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar_cuota" ADD CONSTRAINT "cuenta_por_cobrar_cuota_cuenta_por_cobrar_id_fkey" FOREIGN KEY ("cuenta_por_cobrar_id") REFERENCES "cuenta_por_cobrar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar_aplicacion" ADD CONSTRAINT "cuenta_por_cobrar_aplicacion_cuota_id_fkey" FOREIGN KEY ("cuota_id") REFERENCES "cuenta_por_cobrar_cuota"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cuenta_por_cobrar_aplicacion" ADD CONSTRAINT "cuenta_por_cobrar_aplicacion_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "venta_pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;
