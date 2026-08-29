import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  PuntoQrAsistenciaEstado,
  SucursalEstado,
  SucursalTipo,
} from '@prisma/client';
import { AttendanceQrPointsService } from './attendance-qr-points.service';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,test'),
  },
}));

jest.mock('node:crypto', () => ({
  randomUUID: () => '11111111-2222-3333-4444-555555555555',
}));

describe('AttendanceQrPointsService', () => {
  type MockPrisma = {
    $transaction: jest.Mock<
      Promise<unknown>,
      [Promise<unknown>[] | ((tx: MockPrisma) => Promise<unknown>)]
    >;
    puntoQrAsistencia: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    sucursal: {
      findFirst: jest.Mock;
    };
  };

  const empresaId = 10n;
  const branch = {
    id: 3n,
    nombre: 'Principal',
    tipo: SucursalTipo.tienda,
    direccion: 'Av. Lima 123',
    distrito: 'Lima',
  };
  const point = {
    id: 1n,
    empresaId,
    sucursalId: branch.id,
    nombre: 'Entrada principal',
    codigo: 'qrp_test',
    latitud: -12.0464,
    longitud: -77.0428,
    precisionMetros: 12,
    radioMetros: 100,
    estado: PuntoQrAsistenciaEstado.activo,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    sucursal: branch,
  };

  function createService(overrides?: {
    branchExists?: boolean;
    createError?: Error;
    limitError?: Error;
  }) {
    const prisma: MockPrisma = {
      $transaction: jest.fn((input) =>
        typeof input === 'function' ? input(prisma) : Promise.all(input),
      ),
      puntoQrAsistencia: {
        create: jest.fn().mockImplementation(({ data }) => {
          if (overrides?.createError) {
            return Promise.reject(overrides.createError);
          }
          return Promise.resolve({ ...point, ...data, sucursal: branch });
        }),
        findFirst: jest.fn().mockResolvedValue(point),
        update: jest.fn().mockResolvedValue(point),
      },
      sucursal: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides?.branchExists === false ? null : branch),
      },
    };
    const service = new AttendanceQrPointsService(
      prisma as never,
      { get: () => undefined } as never,
      {
        assertResourceLimits: jest.fn().mockImplementation(() => {
          if (overrides?.limitError) {
            return Promise.reject(overrides.limitError);
          }
          return Promise.resolve();
        }),
      } as never,
    );

    return { service, prisma };
  }

  it('crea un punto QR valido con sucursal activa', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create(empresaId, {
        nombre: ' Entrada principal ',
        sucursalId: '3',
        latitud: -12.0464,
        longitud: -77.0428,
        precisionMetros: 12,
        radioMetros: 150,
      }),
    ).resolves.toMatchObject({
      id: '1',
      nombre: 'Entrada principal',
      sucursalId: '3',
      radioMetros: 150,
    });
    expect(prisma.sucursal.findFirst).toHaveBeenCalledWith({
      where: { id: 3n, empresaId, estado: SucursalEstado.activo },
      select: { id: true },
    });
    expect(prisma.puntoQrAsistencia.create).toHaveBeenCalledWith({
      data: {
        empresaId,
        codigo: 'qrp_11111111222233334444555555555555',
        dynamicSecret:
          '1111111122223333444455555555555511111111222233334444555555555555',
        sucursalId: 3n,
        nombre: 'Entrada principal',
        latitud: -12.0464,
        longitud: -77.0428,
        precisionMetros: 12,
        radioMetros: 150,
        tipoQr: 'normal',
        refreshSeconds: 20,
        estado: PuntoQrAsistenciaEstado.activo,
      },
      include: {
        sucursal: {
          select: {
            id: true,
            nombre: true,
            tipo: true,
            direccion: true,
            distrito: true,
          },
        },
      },
    });
  });

  it('valida limite del plan al crear punto QR activo', async () => {
    const limitError = new ConflictException({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'attendanceQrPoints',
    });
    const { service } = createService({ limitError });

    await expect(
      service.create(empresaId, {
        nombre: 'Entrada',
        sucursalId: '3',
        latitud: -12,
        longitud: -77,
      }),
    ).rejects.toThrow(limitError);
  });

  it('rechaza sucursal inexistente o inactiva', async () => {
    const { service } = createService({ branchExists: false });

    await expect(
      service.create(empresaId, {
        nombre: 'Entrada',
        sucursalId: '99',
        latitud: -12,
        longitud: -77,
      }),
    ).rejects.toThrow(
      new BadRequestException('Selecciona una sucursal activa'),
    );
  });

  it('rechaza nombre duplicado por empresa', async () => {
    const duplicateName = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      },
    );
    const { service } = createService({ createError: duplicateName });

    await expect(
      service.create(empresaId, {
        nombre: 'Entrada',
        sucursalId: '3',
        latitud: -12,
        longitud: -77,
      }),
    ).rejects.toThrow(
      new ConflictException('Ya existe un punto QR con ese nombre'),
    );
  });

  it('rechaza radio fuera de rango', async () => {
    const { service } = createService();

    await expect(
      service.create(empresaId, {
        nombre: 'Entrada',
        sucursalId: '3',
        latitud: -12,
        longitud: -77,
        radioMetros: 5,
      }),
    ).rejects.toThrow(new BadRequestException('Radio invalido'));
  });

  it('genera el QR estatico del punto', async () => {
    const { service } = createService();

    await expect(service.getQr(empresaId, 1n)).resolves.toMatchObject({
      content: 'attendance-qr:qrp_test',
      dataUrl: 'data:image/png;base64,test',
    });
  });
});
