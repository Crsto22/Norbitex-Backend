import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ??= buildDatabaseUrl();

const prisma = new PrismaClient();

async function main() {
  await prisma.rol.createMany({
    data: [
      {
        codigo: 'OWNER',
        nombre: 'Propietario',
        descripcion: 'Dueno de la empresa con acceso total',
      },
      {
        codigo: 'ADMIN',
        nombre: 'Administrador',
        descripcion: 'Administra usuarios y configuraciones de la empresa',
      },
      {
        codigo: 'VENDEDOR',
        nombre: 'Vendedor',
        descripcion: 'Gestiona ventas y clientes',
      },
      {
        codigo: 'ALMACENERO',
        nombre: 'Almacenero',
        descripcion: 'Gestiona stock, productos y almacenes',
      },
    ],
    skipDuplicates: true,
  });
}

function buildDatabaseUrl() {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'Nobitex';
  const user = process.env.DB_USER ?? 'postgres';
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `postgresql://${user}:${password}@${urlHost}:${port}/${database}?schema=public`;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
