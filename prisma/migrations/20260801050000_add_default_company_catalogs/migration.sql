WITH defaults(nombre, nombre_key, hex) AS (
  VALUES
    ('Negro', 'negro', '#000000'),
    ('Blanco', 'blanco', '#FFFFFF'),
    ('Gris', 'gris', '#6B7280'),
    ('Rojo', 'rojo', '#DC2626'),
    ('Azul marino', 'azul marino', '#1E3A5F'),
    ('Azul', 'azul', '#2563EB'),
    ('Celeste', 'celeste', '#38BDF8'),
    ('Verde', 'verde', '#16A34A'),
    ('Rosado', 'rosado', '#EC4899'),
    ('Beige', 'beige', '#D2B48C'),
    ('Marrón', 'marrón', '#8B4513'),
    ('Morado', 'morado', '#7C3AED'),
    ('Naranja', 'naranja', '#F97316'),
    ('Amarillo', 'amarillo', '#EAB308'),
    ('Coral', 'coral', '#FF6B6B'),
    ('Turquesa', 'turquesa', '#14B8A6'),
    ('Vino', 'vino', '#722F37'),
    ('Oliva', 'oliva', '#808000'),
    ('Crema', 'crema', '#FFFDD0'),
    ('Lila', 'lila', '#C4B5FD')
)
INSERT INTO "color" (
  "empresa_id", "nombre", "nombre_key", "hex", "activo", "created_at", "updated_at"
)
SELECT e."id", d.nombre, d.nombre_key, d.hex, true, now(), now()
FROM "empresa" e
CROSS JOIN defaults d
ON CONFLICT ("empresa_id", "nombre_key") DO UPDATE SET
  "activo" = true,
  "deleted_at" = NULL,
  "updated_at" = now();

WITH defaults(nombre, nombre_key) AS (
  VALUES
    ('XS', 'xs'), ('S', 's'), ('M', 'm'), ('L', 'l'), ('XL', 'xl'), ('XXL', 'xxl'),
    ('34', '34'), ('35', '35'), ('36', '36'), ('37', '37'), ('38', '38'),
    ('39', '39'), ('40', '40'), ('41', '41'), ('42', '42'), ('43', '43'),
    ('44', '44'), ('45', '45'), ('46', '46'), ('47', '47'), ('48', '48')
)
INSERT INTO "talla" (
  "empresa_id", "nombre", "nombre_key", "activo", "created_at", "updated_at"
)
SELECT e."id", d.nombre, d.nombre_key, true, now(), now()
FROM "empresa" e
CROSS JOIN defaults d
ON CONFLICT ("empresa_id", "nombre_key") DO UPDATE SET
  "activo" = true,
  "deleted_at" = NULL,
  "updated_at" = now();
