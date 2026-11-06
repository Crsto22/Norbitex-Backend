CREATE TYPE "VentaEntregaTipo" AS ENUM ('CLIENTE', 'COURIER');
CREATE TYPE "VentaEnvioEstadoLogistico" AS ENUM ('POR_PREPARAR', 'POR_DESPACHAR', 'EN_TRANSITO', 'ENTREGADO', 'INCIDENCIA');
CREATE TYPE "VentaEnvioIncidenciaEstado" AS ENUM ('ABIERTA', 'RESUELTA');

ALTER TABLE "venta_entrega"
  ADD COLUMN "tipo" "VentaEntregaTipo" NOT NULL DEFAULT 'CLIENTE',
  ADD COLUMN "numero_constancia" VARCHAR(120);

ALTER TABLE "venta_envio"
  ADD COLUMN "estado_logistico" "VentaEnvioEstadoLogistico" NOT NULL DEFAULT 'POR_PREPARAR',
  ADD COLUMN "despachado_at" TIMESTAMPTZ(6),
  ADD COLUMN "entregado_at" TIMESTAMPTZ(6);

UPDATE "venta_envio"
SET "estado_logistico" = 'POR_DESPACHAR'
WHERE "estado" = 'recibido';

CREATE INDEX "venta_envio_estado_logistico_idx" ON "venta_envio"("estado_logistico");

CREATE TABLE "venta_envio_historial" (
  "id" BIGSERIAL NOT NULL,
  "venta_envio_id" BIGINT NOT NULL,
  "estado_anterior" "VentaEnvioEstadoLogistico",
  "estado_nuevo" "VentaEnvioEstadoLogistico" NOT NULL,
  "detalle" VARCHAR(500),
  "usuario_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venta_envio_historial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "venta_envio_historial_venta_envio_id_created_at_idx"
  ON "venta_envio_historial"("venta_envio_id", "created_at");
CREATE INDEX "venta_envio_historial_usuario_id_idx"
  ON "venta_envio_historial"("usuario_id");

ALTER TABLE "venta_envio_historial"
  ADD CONSTRAINT "venta_envio_historial_venta_envio_id_fkey"
  FOREIGN KEY ("venta_envio_id") REFERENCES "venta_envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venta_envio_historial"
  ADD CONSTRAINT "venta_envio_historial_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "venta_envio_incidencia" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(30) NOT NULL,
  "venta_envio_id" BIGINT NOT NULL,
  "motivo" VARCHAR(100) NOT NULL,
  "descripcion" VARCHAR(500) NOT NULL,
  "estado" "VentaEnvioIncidenciaEstado" NOT NULL DEFAULT 'ABIERTA',
  "estado_anterior" "VentaEnvioEstadoLogistico" NOT NULL,
  "solucion" VARCHAR(500),
  "creada_por_id" BIGINT,
  "resuelta_por_id" BIGINT,
  "resuelta_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "venta_envio_incidencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venta_envio_incidencia_public_id_key"
  ON "venta_envio_incidencia"("public_id");
CREATE INDEX "venta_envio_incidencia_venta_envio_id_estado_idx"
  ON "venta_envio_incidencia"("venta_envio_id", "estado");
CREATE UNIQUE INDEX "venta_envio_incidencia_abierta_venta_envio_id_key"
  ON "venta_envio_incidencia"("venta_envio_id")
  WHERE "estado" = 'ABIERTA';
CREATE INDEX "venta_envio_incidencia_creada_por_id_idx"
  ON "venta_envio_incidencia"("creada_por_id");
CREATE INDEX "venta_envio_incidencia_resuelta_por_id_idx"
  ON "venta_envio_incidencia"("resuelta_por_id");

ALTER TABLE "venta_envio_incidencia"
  ADD CONSTRAINT "venta_envio_incidencia_venta_envio_id_fkey"
  FOREIGN KEY ("venta_envio_id") REFERENCES "venta_envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venta_envio_incidencia"
  ADD CONSTRAINT "venta_envio_incidencia_creada_por_id_fkey"
  FOREIGN KEY ("creada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "venta_envio_incidencia"
  ADD CONSTRAINT "venta_envio_incidencia_resuelta_por_id_fkey"
  FOREIGN KEY ("resuelta_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
