const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "producto" ALTER COLUMN "public_id" SET NOT NULL'
  );
  console.log("Set public_id NOT NULL");

  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "producto_public_id_key"'
  );
  console.log("Dropped partial unique index");

  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "producto_public_id_key" ON "producto"("public_id")'
  );
  console.log("Created full unique index");
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());