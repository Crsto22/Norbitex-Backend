-- CreateEnum
CREATE TYPE "EmpresaEstado" AS ENUM ('activa', 'inactiva', 'suspendida');

-- CreateEnum
CREATE TYPE "UsuarioEstado" AS ENUM ('activo', 'inactivo', 'bloqueado');

-- CreateEnum
CREATE TYPE "EmpresaUsuarioEstado" AS ENUM ('activo', 'inactivo', 'invitado');

-- CreateTable
CREATE TABLE "empresa" (
    "id" BIGSERIAL NOT NULL,
    "nombre_comercial" VARCHAR(150) NOT NULL,
    "razon_social" VARCHAR(200),
    "ruc" VARCHAR(20),
    "telefono" VARCHAR(30),
    "email" VARCHAR(150),
    "direccion" TEXT,
    "estado" "EmpresaEstado" NOT NULL DEFAULT 'activa',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "apellido" VARCHAR(100),
    "email" VARCHAR(180) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "telefono" VARCHAR(30),
    "estado" "UsuarioEstado" NOT NULL DEFAULT 'activo',
    "email_verificado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_usuario" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "estado" "EmpresaUsuarioEstado" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "empresa_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_usuario_rol" (
    "id" BIGSERIAL NOT NULL,
    "empresa_usuario_id" BIGINT NOT NULL,
    "rol_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_usuario_rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "empresa_id" BIGINT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_ruc_key" ON "empresa"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "empresa_usuario_empresa_id_idx" ON "empresa_usuario"("empresa_id");

-- CreateIndex
CREATE INDEX "empresa_usuario_usuario_id_idx" ON "empresa_usuario"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_usuario_empresa_id_usuario_id_key" ON "empresa_usuario"("empresa_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "rol_codigo_key" ON "rol"("codigo");

-- CreateIndex
CREATE INDEX "empresa_usuario_rol_empresa_usuario_id_idx" ON "empresa_usuario_rol"("empresa_usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_usuario_rol_empresa_usuario_id_rol_id_key" ON "empresa_usuario_rol"("empresa_usuario_id", "rol_id");

-- CreateIndex
CREATE INDEX "refresh_token_usuario_id_idx" ON "refresh_token"("usuario_id");

-- CreateIndex
CREATE INDEX "refresh_token_empresa_id_idx" ON "refresh_token"("empresa_id");

-- CreateIndex
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- AddForeignKey
ALTER TABLE "empresa_usuario" ADD CONSTRAINT "empresa_usuario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_usuario" ADD CONSTRAINT "empresa_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_usuario_rol" ADD CONSTRAINT "empresa_usuario_rol_empresa_usuario_id_fkey" FOREIGN KEY ("empresa_usuario_id") REFERENCES "empresa_usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_usuario_rol" ADD CONSTRAINT "empresa_usuario_rol_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
