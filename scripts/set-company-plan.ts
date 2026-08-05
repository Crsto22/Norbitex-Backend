import { PlanCodigo, PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ??= buildDatabaseUrl();

const prisma = new PrismaClient();

async function main() {
  const empresaId = readPositiveInteger('--empresa');
  const plan = readPlan();
  const months =
    plan === PlanCodigo.prueba ? null : readPositiveInteger('--months');
  const startsAt = new Date();
  const endsAt = new Date(startsAt);

  if (plan === PlanCodigo.prueba) {
    endsAt.setUTCDate(endsAt.getUTCDate() + 7);
  } else {
    endsAt.setUTCMonth(endsAt.getUTCMonth() + months!);
  }

  const company = await prisma.$transaction(async (tx) => {
    const current = await tx.empresa.findUniqueOrThrow({
      where: { id: BigInt(empresaId) },
      select: {
        id: true,
        nombreComercial: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
      },
    });
    const updated = await tx.empresa.update({
      where: { id: current.id },
      data: {
        planCodigo: plan,
        planInicioAt: startsAt,
        planFinAt: endsAt,
      },
      select: {
        id: true,
        nombreComercial: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
      },
    });

    await tx.platformAuditLog.create({
      data: {
        empresaId: current.id,
        category: 'plan',
        action: 'plan_changed',
        source: 'cli',
        description: `Plan cambiado de ${current.planCodigo} a ${plan}`,
        metadata: {
          fromPlan: current.planCodigo,
          toPlan: plan,
          previousStartsAt: current.planInicioAt.toISOString(),
          previousEndsAt: current.planFinAt?.toISOString() ?? null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          months,
        },
      },
    });

    return updated;
  });

  console.log({
    ...company,
    id: company.id.toString(),
  });
}

function readPlan() {
  const value = readArgument('--plan');

  if (!Object.values(PlanCodigo).includes(value as PlanCodigo)) {
    throw new Error(`Plan invalido: ${value}`);
  }

  return value as PlanCodigo;
}

function readPositiveInteger(name: string) {
  const value = Number(readArgument(name));

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero mayor a cero`);
  }

  return value;
}

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;

  if (!value) {
    throw new Error(`Falta el argumento ${name}`);
  }

  return value;
}

function buildDatabaseUrl() {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'Nobitex';
  const user = process.env.DB_USER ?? 'postgres';
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const urlHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `postgresql://${user}:${password}@${urlHost}:${port}/${database}?schema=public`;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
