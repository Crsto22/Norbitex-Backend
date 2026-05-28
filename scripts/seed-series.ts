const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function seedSeries() {
  const empresas = await prisma.empresa.findMany({ select: { id: true } });

  for (const empresa of empresas) {
    const existing = await prisma.serieComprobante.findMany({
      where: { empresaId: empresa.id },
    });

    if (existing.length > 0) {
      console.log(`Empresa ${empresa.id} ya tiene ${existing.length} series, saltando...`);
      continue;
    }

    await prisma.serieComprobante.createMany({
      data: [
        {
          empresaId: empresa.id,
          tipoComprobante: "nota_venta",
          serie: "NV01",
          esPrincipal: true,
          numeroActual: 0,
        },
        {
          empresaId: empresa.id,
          tipoComprobante: "factura",
          serie: "F001",
          esPrincipal: true,
          numeroActual: 0,
        },
        {
          empresaId: empresa.id,
          tipoComprobante: "boleta",
          serie: "B001",
          esPrincipal: true,
          numeroActual: 0,
        },
      ],
    });

    console.log(`Empresa ${empresa.id}: 3 series creadas`);
  }

  await prisma.$disconnect();
  console.log("Done!");
}

seedSeries().catch((e) => {
  console.error(e);
  process.exit(1);
});