import { spawn } from 'node:child_process';
import { join } from 'node:path';

process.env.DATABASE_URL ??= buildDatabaseUrl();
process.env.RUST_BACKTRACE ??= '1';
process.env.PRISMA_SCHEMA_ENGINE_LOG_LEVEL ??= 'trace';

const args = process.argv.slice(2);
const command = join(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const child = spawn(process.execPath, [command, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

function buildDatabaseUrl() {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'Nobitex';
  const user = process.env.DB_USER ?? 'postgres';
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `postgresql://${user}:${password}@${urlHost}:${port}/${database}?schema=public`;
}
