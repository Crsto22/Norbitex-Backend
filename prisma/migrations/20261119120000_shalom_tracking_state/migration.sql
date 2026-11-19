-- Estado de rastreo de Shalom en el envio.

ALTER TABLE "venta_envio"
  ADD COLUMN "shalom_estado_label" varchar(80),
  ADD COLUMN "shalom_progreso" smallint,
  ADD COLUMN "shalom_timeline" jsonb;
