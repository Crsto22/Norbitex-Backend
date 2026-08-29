import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, TurnoEstado } from '@prisma/client';
import { ShiftsService } from './shifts.service';

describe('ShiftsService', () => {
  const empresaId = 10n;
  const shift = {
    id: 1n,
    empresaId,
    nombre: 'Manana',
    horaEntrada: '09:00',
    horaSalida: '18:00',
    diasLaborables: [1, 2, 3, 4, 5],
    estado: TurnoEstado.activo,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    _count: { empleados: 2 },
  };

  function createService(overrides?: {
    shiftMatch?: typeof shift | null;
    employeeMatches?: { id: bigint }[];
    createError?: Error;
  }) {
    const tx = {
      empleado: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      turno: {
        findFirstOrThrow: jest.fn().mockResolvedValue(shift),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (
          input:
            | Promise<unknown>[]
            | ((transaction: typeof tx) => Promise<unknown>),
        ) => (Array.isArray(input) ? Promise.all(input) : input(tx)),
      ),
      turno: {
        findFirst: jest.fn().mockResolvedValue(overrides?.shiftMatch ?? shift),
        create: jest.fn().mockImplementation(() => {
          if (overrides?.createError) {
            return Promise.reject(overrides.createError);
          }
          return Promise.resolve(shift);
        }),
      },
      empleado: {
        findMany: jest.fn().mockResolvedValue(overrides?.employeeMatches ?? []),
      },
    };
    const service = new ShiftsService(
      prisma as never,
      { get: () => undefined } as never,
    );

    return { service, prisma, tx };
  }

  it('crea un turno valido', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create(empresaId, {
        nombre: ' Manana ',
        horaEntrada: '09:00',
        horaSalida: '18:00',
        diasLaborables: [5, 1, 1],
      }),
    ).resolves.toMatchObject({
      id: '1',
      nombre: 'Manana',
      horaEntrada: '09:00',
      horaSalida: '18:00',
      assignedEmployeesTotal: 2,
    });
    expect(prisma.turno.create).toHaveBeenCalledWith({
      data: {
        empresaId,
        nombre: 'Manana',
        horaEntrada: '09:00',
        horaSalida: '18:00',
        diasLaborables: [1, 5],
        estado: TurnoEstado.activo,
      },
      include: { _count: { select: { empleados: true } } },
    });
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
        nombre: 'Manana',
        horaEntrada: '09:00',
        horaSalida: '18:00',
        diasLaborables: [1],
      }),
    ).rejects.toThrow(
      new ConflictException('Ya existe un turno con ese nombre'),
    );
  });

  it('rechaza salida menor o igual a entrada', async () => {
    const { service } = createService();

    await expect(
      service.create(empresaId, {
        nombre: 'Noche',
        horaEntrada: '22:00',
        horaSalida: '06:00',
        diasLaborables: [1],
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'La hora de salida debe ser mayor a la hora de entrada',
      ),
    );
  });

  it('rechaza asignar personal a turno inactivo', async () => {
    const { service } = createService({
      shiftMatch: { ...shift, estado: TurnoEstado.inactivo },
    });

    await expect(
      service.assignEmployees(empresaId, 1n, { employeeIds: ['1'] }),
    ).rejects.toThrow(
      new ConflictException('Solo puedes asignar personal a turnos activos'),
    );
  });

  it('rechaza trabajadores que no son activos de la empresa', async () => {
    const { service } = createService({ employeeMatches: [{ id: 1n }] });

    await expect(
      service.assignEmployees(empresaId, 1n, { employeeIds: ['1', '2'] }),
    ).rejects.toThrow(
      new BadRequestException(
        'Selecciona solo trabajadores activos de esta empresa',
      ),
    );
  });

  it('reemplaza los trabajadores asignados al turno', async () => {
    const { service, tx } = createService({
      employeeMatches: [{ id: 1n }, { id: 2n }],
    });

    await expect(
      service.assignEmployees(empresaId, 1n, { employeeIds: ['1', '2'] }),
    ).resolves.toMatchObject({ id: '1', assignedEmployeesTotal: 2 });
    expect(tx.empleado.updateMany).toHaveBeenCalledWith({
      where: { empresaId, turnoId: 1n },
      data: { turnoId: null },
    });
    expect(tx.empleado.updateMany).toHaveBeenCalledWith({
      where: { empresaId, id: { in: [1n, 2n] } },
      data: { turnoId: 1n },
    });
  });
});
