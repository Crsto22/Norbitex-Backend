CREATE TYPE "ProductoTipo" AS ENUM ('normal', 'variantes');

ALTER TABLE "producto"
  ADD COLUMN "tipo" "ProductoTipo" NOT NULL DEFAULT 'variantes';

ALTER TABLE "color"
  ADD COLUMN "sistema_codigo" VARCHAR(40);

ALTER TABLE "talla"
  ADD COLUMN "sistema_codigo" VARCHAR(40);

CREATE UNIQUE INDEX "color_empresa_id_sistema_codigo_key"
  ON "color"("empresa_id", "sistema_codigo");

CREATE UNIQUE INDEX "talla_empresa_id_sistema_codigo_key"
  ON "talla"("empresa_id", "sistema_codigo");
