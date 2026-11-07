ALTER TABLE "empresa_envio_config"
  ADD COLUMN "direccion" VARCHAR(300);

ALTER TABLE "venta_envio"
  ADD COLUMN "metodo_envio" VARCHAR(50);
