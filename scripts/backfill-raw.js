const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRawUnsafe(
    "UPDATE producto SET public_id = CONCAT('cl', SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 22)) WHERE public_id IS NULL"
  );
  console.log("Updated", result, "products");
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());