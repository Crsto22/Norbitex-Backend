import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: getDatabaseUrl(),
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.DATABASE_URL) {
    return withPoolSettings(env.DATABASE_URL, env);
  }

  const host = env.DB_HOST ?? 'localhost';
  const port = env.DB_PORT ?? '5432';
  const database = env.DB_NAME ?? 'Nuvex';
  const user = env.DB_USER ?? 'postgres';
  const password = encodeURIComponent(env.DB_PASSWORD ?? '');

  return withPoolSettings(
    `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`,
    env,
  );
}

function withPoolSettings(databaseUrl: string, env: NodeJS.ProcessEnv) {
  const url = new URL(databaseUrl);
  setMissingPositiveInt(
    url,
    'connection_limit',
    env.DB_POOL_CONNECTION_LIMIT,
    '10',
  );
  setMissingPositiveInt(url, 'pool_timeout', env.DB_POOL_TIMEOUT_SECONDS, '10');

  return url.toString();
}

function setMissingPositiveInt(
  url: URL,
  key: string,
  value: string | undefined,
  fallback: string,
) {
  if (url.searchParams.has(key)) return;

  const parsed = Number(value ?? fallback);
  if (Number.isInteger(parsed) && parsed > 0) {
    url.searchParams.set(key, String(parsed));
  }
}
