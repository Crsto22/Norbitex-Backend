-- Agencia de origen usada al registrar la guia en Shalom.

ALTER TABLE "venta_envio"
  ADD COLUMN "shalom_origen" varchar(120);
