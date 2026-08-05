CREATE TABLE "empresa_usuario_modulo" (
  "id" BIGSERIAL NOT NULL,
  "empresa_usuario_id" BIGINT NOT NULL,
  "module_key" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "empresa_usuario_modulo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_usuario_modulo_empresa_usuario_id_module_key_key"
  ON "empresa_usuario_modulo"("empresa_usuario_id", "module_key");

CREATE INDEX "empresa_usuario_modulo_empresa_usuario_id_idx"
  ON "empresa_usuario_modulo"("empresa_usuario_id");

ALTER TABLE "empresa_usuario_modulo"
  ADD CONSTRAINT "empresa_usuario_modulo_empresa_usuario_id_fkey"
  FOREIGN KEY ("empresa_usuario_id")
  REFERENCES "empresa_usuario"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

INSERT INTO "empresa_usuario_modulo" ("empresa_usuario_id", "module_key")
SELECT "empresa_usuario"."id", "modules"."module_key"
FROM "empresa_usuario"
CROSS JOIN (
  VALUES
    ('dashboard'),
    ('ventas-pos'),
    ('caja'),
    ('cotizaciones'),
    ('clientes'),
    ('historial-ventas'),
    ('historial-cotizaciones'),
    ('comprobantes'),
    ('nota-credito'),
    ('series'),
    ('gre-remitente'),
    ('conductores'),
    ('productos'),
    ('categorias'),
    ('marcas'),
    ('tallas'),
    ('colores'),
    ('sucursales'),
    ('usuarios'),
    ('empresa'),
    ('metodos-pago')
) AS "modules"("module_key")
ON CONFLICT ("empresa_usuario_id", "module_key") DO NOTHING;
