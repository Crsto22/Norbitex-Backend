import { ConflictException } from '@nestjs/common';
import { EmpleadoEstado, EmpleadoTipoDocumento, Prisma } from '@prisma/client';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  type MockPrisma = {
    $transaction: jest.Mock<
      Promise<unknown>,
      [Promise<unknown>[] | ((tx: MockPrisma) => Promise<unknown>)]
    >;
    empleado: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    usuario: {
      findUnique: jest.Mock;
    };
  };

  const empresaId = 10n;
  const employee = {
    id: 1n,
    empresaId,
    tipoDocumento: EmpleadoTipoDocumento.dni,
    numeroDocumento: '12345678',
    nombres: 'JUAN',
    apellidoPaterno: 'PEREZ',
    apellidoMaterno: 'ROJAS',
    email: 'juan@test.com',
    telefono: '999888777',
    estado: EmpleadoEstado.activo,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  function createService(overrides?: {
    employeeMatch?: { id: bigint } | null;
    userMatch?: { id: bigint } | null;
    createError?: Error;
    limitError?: Error;
  }) {
    const prisma: MockPrisma = {
      $transaction: jest.fn((input) =>
        typeof input === 'function' ? input(prisma) : Promise.all(input),
      ),
      empleado: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides?.employeeMatch ?? null),
        create: jest.fn().mockImplementation(() => {
          if (overrides?.createError) {
            return Promise.reject(overrides.createError);
          }
          return Promise.resolve(employee);
        }),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(overrides?.userMatch ?? null),
      },
    };
    const service = new EmployeesService(
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

  it('crea un trabajador con DNI valido y correo normalizado', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create(empresaId, {
        tipoDocumento: 'dni',
        numeroDocumento: '12345678',
        nombres: ' Juan ',
        apellidoPaterno: ' Perez ',
        apellidoMaterno: ' Rojas ',
        email: ' JUAN@Test.COM ',
        telefono: ' 999888777 ',
      }),
    ).resolves.toMatchObject({
      id: '1',
      email: 'juan@test.com',
      numeroDocumento: '12345678',
      estado: EmpleadoEstado.activo,
    });
    const [createArgs] = prisma.empleado.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data).toMatchObject({
      empresaId,
      turnoId: null,
      tipoDocumento: EmpleadoTipoDocumento.dni,
      numeroDocumento: '12345678',
      email: 'juan@test.com',
      nombres: 'Juan',
      apellidoPaterno: 'Perez',
      apellidoMaterno: 'Rojas',
      telefono: '999888777',
      estado: EmpleadoEstado.activo,
    });
  });

  it('valida limite del plan al crear trabajador activo', async () => {
    const limitError = new ConflictException({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'attendanceEmployees',
    });
    const { service } = createService({ limitError });

    await expect(
      service.create(empresaId, {
        tipoDocumento: 'dni',
        numeroDocumento: '12345678',
        nombres: 'Juan',
        email: 'juan@test.com',
        telefono: '999888777',
      }),
    ).rejects.toThrow(limitError);
  });

  it('rechaza correo existente en usuarios administrativos', async () => {
    const { service } = createService({ userMatch: { id: 7n } });

    await expect(
      service.create(empresaId, {
        tipoDocumento: 'dni',
        numeroDocumento: '12345678',
        nombres: 'Juan',
        email: 'admin@test.com',
        telefono: '999888777',
      }),
    ).rejects.toThrow(
      new ConflictException('El correo ya esta registrado en el sistema'),
    );
  });

  it('rechaza documento duplicado en la misma empresa', async () => {
    const duplicateDocument = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
        meta: {
          target: ['empresa_id', 'tipo_documento', 'numero_documento'],
        },
      },
    );
    const { service } = createService({ createError: duplicateDocument });

    await expect(
      service.create(empresaId, {
        tipoDocumento: 'dni',
        numeroDocumento: '12345678',
        nombres: 'Juan',
        email: 'juan@test.com',
        telefono: '999888777',
      }),
    ).rejects.toThrow(
      new ConflictException('Ya existe un trabajador con ese documento'),
    );
  });
});
