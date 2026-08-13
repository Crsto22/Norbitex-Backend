import { getDatabaseUrl } from './prisma.service';

describe('getDatabaseUrl', () => {
  it('adds pool settings when they are missing', () => {
    const url = getDatabaseUrl({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      DB_POOL_CONNECTION_LIMIT: '7',
      DB_POOL_TIMEOUT_SECONDS: '9',
    });

    expect(url).toContain('connection_limit=7');
    expect(url).toContain('pool_timeout=9');
  });

  it('keeps existing pool settings from DATABASE_URL', () => {
    const url = getDatabaseUrl({
      DATABASE_URL:
        'postgresql://user:pass@localhost:5432/db?schema=public&connection_limit=2',
      DB_POOL_CONNECTION_LIMIT: '7',
    });

    expect(url).toContain('connection_limit=2');
  });
});
