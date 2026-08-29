ALTER TABLE "comprobante_plataforma"
  ADD COLUMN "suscripcion_asistencia_id" BIGINT;

CREATE UNIQUE INDEX "comprobante_plataforma_suscripcion_asistencia_id_key"
  ON "comprobante_plataforma"("suscripcion_asistencia_id");

ALTER TABLE "comprobante_plataforma"
  ADD CONSTRAINT "comprobante_plataforma_suscripcion_asistencia_id_fkey"
  FOREIGN KEY ("suscripcion_asistencia_id") REFERENCES "suscripcion_asistencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
