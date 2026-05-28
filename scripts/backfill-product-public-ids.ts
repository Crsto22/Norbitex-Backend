import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

process.env.DATABASE_URL ??= buildDatabaseUrl();

const prisma = new PrismaClient();

async function main() {
  console.log('Backfilling publicId for existing products...');

  const products = await prisma.producto.findMany({
    select: { id: true, publicId: true },
  });

  const productsWithoutPublicId = products.filter((p) => !p.publicId);

  if (productsWithoutPublicId.length === 0) {
    console.log('All products already have a publicId. Nothing to do.');
    return;
  }

  console.log(
    `Found ${productsWithoutPublicId.length} products without publicId.`,
  );

  let updated = 0;

  for (const product of productsWithoutPublicId) {
    await prisma.producto.update({
      where: { id: product.id },
      data: { publicId: createId() },
    });
    updated++;

    if (updated % 50 === 0) {
      console.log(`Updated ${updated}/${productsWithoutPublicId.length}...`);
    }
  }

  console.log(`Done! Updated ${updated} products with publicId.`);
}

main()
  .catch((error) => {
    console.error('Error backfilling publicId:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

function buildDatabaseUrl() {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'Nobitex';
  const user = process.env.DB_USER ?? 'postgres';
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `postgresql://${user}:${password}@${urlHost}:${port}/${database}?schema=public`;
}