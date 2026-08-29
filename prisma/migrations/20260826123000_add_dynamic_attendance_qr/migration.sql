CREATE TYPE "PuntoQrAsistenciaTipo" AS ENUM ('normal', 'dinamico');

ALTER TABLE "punto_qr_asistencia"
ADD COLUMN "tipo_qr" "PuntoQrAsistenciaTipo" NOT NULL DEFAULT 'normal',
ADD COLUMN "refresh_seconds" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN "dynamic_secret" VARCHAR(80) NOT NULL DEFAULT '';

UPDATE "punto_qr_asistencia"
SET "dynamic_secret" = md5(random()::text || clock_timestamp()::text) || md5(id::text || random()::text)
WHERE "dynamic_secret" = '';

ALTER TABLE "punto_qr_asistencia"
ALTER COLUMN "dynamic_secret" DROP DEFAULT;
