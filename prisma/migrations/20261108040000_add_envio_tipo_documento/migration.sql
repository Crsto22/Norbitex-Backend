ALTER TABLE "venta_envio"
  ADD COLUMN "tipo_documento" VARCHAR(2) NOT NULL DEFAULT 'DNI';

ALTER TABLE "venta_envio"
  ALTER COLUMN "dni" TYPE VARCHAR(12);
