ALTER TABLE "empleado"
ADD COLUMN "worker_device_id_hash" VARCHAR(64),
ADD COLUMN "worker_device_name" VARCHAR(120),
ADD COLUMN "worker_device_user_agent" VARCHAR(500),
ADD COLUMN "worker_device_platform" VARCHAR(80),
ADD COLUMN "worker_device_registered_at" TIMESTAMPTZ(6),
ADD COLUMN "worker_device_last_seen_at" TIMESTAMPTZ(6),
ADD COLUMN "worker_device_latitud" DOUBLE PRECISION,
ADD COLUMN "worker_device_longitud" DOUBLE PRECISION,
ADD COLUMN "worker_device_precision_metros" DOUBLE PRECISION;
