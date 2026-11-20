import { ShalomRegistrationService } from './shalom-registration.service';

describe('ShalomRegistrationService.registerBulk', () => {
  function build(envios: Array<{ publicId: string; dni: string | null }>) {
    const prisma = {
      venta: {
        findMany: jest.fn().mockResolvedValue(
          envios.map((envio) => ({
            publicId: envio.publicId,
            envio: { dni: envio.dni },
          })),
        ),
      },
    };

    const service = new ShalomRegistrationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, prisma };
  }

  const dto = { publicIds: ['a', 'b'], securityKey: '1962' };

  it('rechaza mas de 50 envios por lote', async () => {
    const { service } = build([]);

    await expect(
      service.registerBulk(1n, {
        publicIds: Array.from({ length: 51 }, (_, index) => `p${index}`),
        securityKey: '1962',
      }),
    ).rejects.toThrow(/hasta 50 envios/);
  });

  it('rechaza mas de 10 envios del mismo destinatario', async () => {
    const envios = Array.from({ length: 11 }, (_, index) => ({
      publicId: `p${index}`,
      dni: '12345678',
    }));
    const { service } = build(envios);

    await expect(service.registerBulk(1n, dto)).rejects.toThrow(
      /Maximo 10 envios por destinatario/,
    );
  });

  it('devuelve el resultado por envio sin abortar el lote', async () => {
    const { service } = build([
      { publicId: 'a', dni: '11111111' },
      { publicId: 'b', dni: '22222222' },
    ]);

    jest
      .spyOn(service, 'register')
      .mockResolvedValueOnce({
        alreadyRegistered: false,
        jobId: 'job-a',
        status: 'QUEUED',
      })
      .mockRejectedValueOnce(new Error('El envio no tiene documento'));

    const result = await service.registerBulk(1n, dto);

    expect(result.totals).toEqual({ ok: 1, failed: 1, total: 2 });
    expect(result.results[0]).toMatchObject({
      publicId: 'a',
      ok: true,
      jobId: 'job-a',
      status: 'QUEUED',
    });
    expect(result.results[1]).toMatchObject({
      publicId: 'b',
      ok: false,
      error: 'El envio no tiene documento',
    });
  });
});
