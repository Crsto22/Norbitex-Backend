CREATE TYPE "NotificacionCategoria" AS ENUM ('aviso', 'plan', 'facturacion', 'sunat', 'limite', 'stock', 'empresa');
CREATE TYPE "NotificacionNivel" AS ENUM ('informacion', 'exito', 'advertencia', 'error');
CREATE TYPE "NotificacionOrigen" AS ENUM ('manual', 'automatico');
CREATE TYPE "NotificacionAudiencia" AS ENUM ('todos', 'planes', 'empresa', 'usuario', 'superadmins', 'automatico');

CREATE TABLE "notificacion" (
  "id" BIGSERIAL PRIMARY KEY,
  "empresa_id" BIGINT,
  "creado_por_id" BIGINT,
  "categoria" "NotificacionCategoria" NOT NULL,
  "nivel" "NotificacionNivel" NOT NULL,
  "origen" "NotificacionOrigen" NOT NULL,
  "audiencia" "NotificacionAudiencia" NOT NULL,
  "audiencia_datos" JSONB,
  "titulo" VARCHAR(120) NOT NULL,
  "mensaje" VARCHAR(700) NOT NULL,
  "enlace" VARCHAR(300),
  "clave_evento" VARCHAR(300),
  "expires_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE,
  CONSTRAINT "notificacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL
);

CREATE TABLE "notificacion_destinatario" (
  "id" BIGSERIAL PRIMARY KEY,
  "notificacion_id" BIGINT NOT NULL,
  "usuario_id" BIGINT NOT NULL,
  "leido_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_destinatario_notificacion_id_fkey" FOREIGN KEY ("notificacion_id") REFERENCES "notificacion"("id") ON DELETE CASCADE,
  CONSTRAINT "notificacion_destinatario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "notificacion_clave_evento_key" ON "notificacion"("clave_evento");
CREATE INDEX "notificacion_origen_created_at_idx" ON "notificacion"("origen", "created_at");
CREATE INDEX "notificacion_empresa_id_created_at_idx" ON "notificacion"("empresa_id", "created_at");
CREATE INDEX "notificacion_archived_at_expires_at_idx" ON "notificacion"("archived_at", "expires_at");
CREATE UNIQUE INDEX "notificacion_destinatario_notificacion_id_usuario_id_key" ON "notificacion_destinatario"("notificacion_id", "usuario_id");
CREATE INDEX "notificacion_destinatario_usuario_id_leido_at_id_idx" ON "notificacion_destinatario"("usuario_id", "leido_at", "id");
