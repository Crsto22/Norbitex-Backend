-- CreateEnum
CREATE TYPE "CategoriaProducto" AS ENUM ('ropa', 'zapatillas', 'accesorios', 'ropa_interior_lenceria', 'medias_calcetines', 'ropa_deportiva', 'ropa_bano', 'uniformes_workwear');

-- CreateEnum
CREATE TYPE "CanalConocimiento" AS ENUM ('instagram', 'tiktok', 'facebook', 'youtube', 'google', 'whatsapp', 'recomendacion', 'otro');

-- AlterTable
ALTER TABLE "empresa" ADD COLUMN     "categorias_producto" "CategoriaProducto"[] DEFAULT ARRAY[]::"CategoriaProducto"[],
ADD COLUMN     "como_conocio" "CanalConocimiento",
ADD COLUMN     "como_conocio_otro" VARCHAR(100),
ADD COLUMN     "tipo_negocio" VARCHAR(80);
