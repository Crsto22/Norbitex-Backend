import { AgenciaCourierProveedor } from '@prisma/client';
import { CourierAgenciesService } from './courier-agencies.service';

describe('CourierAgenciesService', () => {
  const prisma = {
    agenciaCourierSincronizacion: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    agenciaCourier: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: CourierAgenciesService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.agenciaCourierSincronizacion.create.mockResolvedValue({ id: 1n });
    prisma.agenciaCourierSincronizacion.update.mockResolvedValue({});
    prisma.agenciaCourier.findMany.mockResolvedValue([]);
    prisma.agenciaCourier.upsert.mockResolvedValue({});
    prisma.agenciaCourier.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (work: unknown) => {
      if (typeof work === 'function') {
        const transaction = work as (client: typeof prisma) => Promise<unknown>;
        return transaction(prisma);
      }
      return Promise.all(work as Promise<unknown>[]);
    });
    service = new CourierAgenciesService(prisma as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('guarda el catalogo completo de Shalom sin paginacion', async () => {
    mockFetch({
      success: true,
      data: [
        {
          ter_id: 392,
          nombre: 'MALVINAS',
          direccion: 'JR. GARCIA VILLON 560',
          departamento: 'LIMA',
          provincia: 'LIMA',
          ubi_id: 150101,
          latitud: '-12.04',
          longitud: '-77.04',
          ter_aereo: 1,
        },
      ],
    });

    await expect(
      service.sync(AgenciaCourierProveedor.SHALOM),
    ).resolves.toMatchObject({
      totalRecibidas: 1,
      creadas: 1,
      actualizadas: 0,
    });
    expect(prisma.agenciaCourier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courier_externalId: {
            courier: AgenciaCourierProveedor.SHALOM,
            externalId: '392',
          },
        },
      }),
    );
    expect(prisma.agenciaCourierSincronizacion.update).toHaveBeenCalledTimes(1);
  });

  it('recorre todas las paginas de Olva antes de finalizar la sincronizacion', async () => {
    const fetchMock: jest.SpiedFunction<typeof fetch> = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response({
          agencies: [olvaAgency('1')],
          pagination: { total_pages: 2 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          agencies: [olvaAgency('2')],
          pagination: { total_pages: 2 },
        }),
      );

    await expect(
      service.sync(AgenciaCourierProveedor.OLVA),
    ).resolves.toMatchObject({
      totalRecibidas: 2,
      creadas: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prisma.agenciaCourier.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.agenciaCourier.updateMany).toHaveBeenCalledTimes(1);
  });

  it('registra el fallo y conserva las agencias actuales si una fuente no responde', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network unavailable'));

    await expect(service.sync(AgenciaCourierProveedor.SHALOM)).rejects.toThrow(
      'No se pudo consultar el catalogo externo',
    );
    expect(prisma.agenciaCourier.updateMany).not.toHaveBeenCalled();
    expect(prisma.agenciaCourierSincronizacion.update).toHaveBeenCalledTimes(1);
  });

  it('ordena por distancia y limita las agencias cercanas', async () => {
    prisma.agenciaCourier.findMany.mockResolvedValue([
      {
        externalId: 'lejos',
        nombre: 'Agencia lejana',
        direccion: null,
        departamento: 'LIMA',
        provincia: 'LIMA',
        distrito: 'LIMA',
        ubigeo: '150101',
        latitud: -12.2,
        longitud: -77.1,
      },
      {
        externalId: 'cerca',
        nombre: 'Agencia cercana',
        direccion: null,
        departamento: 'LIMA',
        provincia: 'LIMA',
        distrito: 'LIMA',
        ubigeo: '150101',
        latitud: -12.041,
        longitud: -77.041,
      },
    ]);

    const result = await service.browseForShipping(
      AgenciaCourierProveedor.SHALOM,
      { latitude: -12.04, longitude: -77.04, take: 1 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ externalId: 'cerca' });
    expect(result[0].distanceKm).toBeLessThan(1);
    expect(prisma.agenciaCourier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direccion: { not: null },
          latitud: { gte: -20, lte: 1 },
          longitud: { gte: -82, lte: -68 },
        }),
      }),
    );
  });

  it('guarda coordenadas vacias de Shalom como nulas', async () => {
    mockFetch({
      success: true,
      data: [
        {
          ter_id: 209,
          nombre: 'CAJA DISTRIBUCION LIMA',
          direccion: '',
          departamento: 'LIMA',
          provincia: 'LIMA',
          latitud: '',
          longitud: '',
        },
      ],
    });

    await service.sync(AgenciaCourierProveedor.SHALOM);

    expect(prisma.agenciaCourier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ latitud: null, longitud: null }),
        update: expect.objectContaining({ latitud: null, longitud: null }),
      }),
    );
  });

  function mockFetch(payload: unknown): jest.SpiedFunction<typeof fetch> {
    return jest.spyOn(global, 'fetch').mockResolvedValue(response(payload));
  }
  function response(payload: unknown) {
    return new Response(JSON.stringify(payload), { status: 200 });
  }
  function olvaAgency(id: string) {
    return {
      id,
      name: `OLVA ${id}`,
      kind: 'office',
      location: {
        address: 'AV. PRINCIPAL 123',
        department: 'LIMA',
        province: 'LIMA',
        district: 'LIMA',
        ubigeo: '150101',
      },
      geo: { lat: -12.04, lng: -77.04 },
      hours: { weekly: [] },
      services: { pickup: true },
      synced_at: '2026-11-05T00:00:00.000Z',
    };
  }
});
