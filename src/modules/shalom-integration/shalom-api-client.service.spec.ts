import { ConfigService } from '@nestjs/config';

import { ShalomApiClientService } from './shalom-api-client.service';

describe('ShalomApiClientService', () => {
  const config = {
    get: (key: string) =>
      key === 'SHALOM_SERVICE_URL' ? 'https://shalom.test' : undefined,
  } as unknown as ConfigService;

  const client = new ShalomApiClientService(config);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockFetch() {
    return jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('autentica la administracion con X-Admin-Token', async () => {
    const spy = mockFetch();

    await client.listSessions('admin-key');

    const headers = spy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('x-admin-token')).toBe('admin-key');
    expect(headers.get('authorization')).toBeNull();
  });

  it('autentica la API de negocio con Authorization Bearer', async () => {
    const spy = mockFetch();

    await client.getJob('job-id', 'api-key');

    const headers = spy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer api-key');
    expect(headers.get('x-admin-token')).toBeNull();
  });
});
