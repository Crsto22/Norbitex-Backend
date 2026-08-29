import {
  EmpleadoEstado,
  MarcajeAsistenciaEstado,
  MarcajeAsistenciaMetodo,
  MarcajeAsistenciaTipo,
} from '@prisma/client';
import { AttendanceTimeEntriesService } from './attendance-time-entries.service';

describe('AttendanceTimeEntriesService', () => {
  const empresaId = 10n;
  const shift: TestShift = {
    id: 1n,
    nombre: 'Manana',
    horaEntrada: '09:00',
    horaSalida: '18:00',
    diasLaborables: [1, 2, 3, 4, 5],
  };
  const employees = [
    employee(1n, 'Ana', shift),
    employee(2n, 'Bruno', shift),
    employee(3n, 'Carla', shift),
    employee(4n, 'Diego', null),
  ];
  const entries = [
    entry(1n, 1n, MarcajeAsistenciaTipo.entrada, '2026-08-24T09:00:00Z'),
    entry(2n, 1n, MarcajeAsistenciaTipo.salida, '2026-08-24T18:00:00Z'),
    entry(3n, 2n, MarcajeAsistenciaTipo.entrada, '2026-08-24T09:10:00Z'),
  ];

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-25T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createService() {
    const prisma = {
      empleado: {
        findMany: jest.fn().mockResolvedValue(employees),
        findFirst: jest.fn().mockResolvedValue({ id: 1n, turnoId: 1n }),
      },
      marcajeAsistencia: {
        findMany: jest.fn().mockResolvedValue(entries),
        count: jest.fn().mockResolvedValue(entries.length),
        create: jest.fn().mockResolvedValue(historyEntry()),
      },
      sucursal: {
        findFirst: jest.fn().mockResolvedValue({ id: 3n }),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const service = new AttendanceTimeEntriesService(prisma as never);

    return { service, prisma };
  }

  function createManualService(dayEntries: unknown[] = []) {
    const prisma = {
      empleado: {
        findMany: jest.fn().mockResolvedValue(employees),
        findFirst: jest.fn().mockResolvedValue({ id: 1n, turnoId: 1n }),
      },
      marcajeAsistencia: {
        findMany: jest.fn().mockResolvedValue(dayEntries),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(historyEntry()),
      },
      sucursal: {
        findFirst: jest.fn().mockResolvedValue({ id: 3n }),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const service = new AttendanceTimeEntriesService(prisma as never);

    return { service, prisma };
  }

  it('retorna matriz de 7 dias por defecto y calcula estados principales', async () => {
    const { service, prisma } = createService();

    const response = await service.findAll(empresaId, {});
    expect(response.range).toBe('7days');
    expect(response.days).toHaveLength(7);
    expect(response.summary).toEqual({
      asistencias: 1,
      faltas: 4,
      tardanzas: 0,
      incompletos: 1,
    });
    expect(response.rows[0].days[0].status).toBe('asistencia');
    expect(response.rows[1].days[0].status).toBe('incompleto');
    expect(response.rows[2].days[0].status).toBe('falta');
    expect(response.rows[3].days[0].status).toBe('sin_turno');
    expect(prisma.empleado.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId, estado: EmpleadoEstado.activo },
      }),
    );
  });

  it('filtra filas por faltas y aplica sucursal a la consulta de marcajes', async () => {
    const { service, prisma } = createService();

    const response = await service.findAll(empresaId, {
      status: 'faltas',
      sucursalId: '3',
    });
    expect(response.rows.map((row) => row.employee.nombres)).toEqual([
      'Ana',
      'Bruno',
      'Carla',
    ]);
    const calls = prisma.marcajeAsistencia.findMany.mock
      .calls as unknown as Array<[{ where?: { sucursalId?: bigint } }]>;
    const firstCall = calls[0]?.[0];
    expect(firstCall?.where?.sucursalId).toBe(3n);
  });

  it('crea una marcacion manual valida', async () => {
    const { service, prisma } = createManualService();

    const response = await service.createManual(empresaId, {
      empleadoId: '1',
      tipo: 'entrada',
      fechaHora: '2026-08-24T09:00:00Z',
      sucursalId: '3',
    });

    expect(response.metodo).toBe('manual');
    const createCalls = prisma.marcajeAsistencia.create.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createArg = createCalls[0][0];
    expect(createArg.data.empleadoId).toBe(1n);
    expect(createArg.data.sucursalId).toBe(3n);
    expect(createArg.data.tipo).toBe('entrada');
    expect(createArg.data.metodo).toBe(MarcajeAsistenciaMetodo.manual);
    expect(createArg.data.estado).toBe(MarcajeAsistenciaEstado.valido);
  });

  it('rechaza duplicar entrada o salida del mismo dia', async () => {
    const { service } = createManualService([
      {
        tipo: MarcajeAsistenciaTipo.entrada,
        fechaHora: new Date('2026-08-24T09:00:00Z'),
      },
    ]);

    await expect(
      service.createManual(empresaId, {
        empleadoId: '1',
        tipo: 'entrada',
        fechaHora: '2026-08-24T09:05:00Z',
      }),
    ).rejects.toThrow('Ya existe una entrada para este dia');
  });

  it('rechaza salida anterior a la entrada existente', async () => {
    const { service } = createManualService([
      {
        tipo: MarcajeAsistenciaTipo.entrada,
        fechaHora: new Date('2026-08-24T09:00:00Z'),
      },
    ]);

    await expect(
      service.createManual(empresaId, {
        empleadoId: '1',
        tipo: 'salida',
        fechaHora: '2026-08-24T08:55:00Z',
      }),
    ).rejects.toThrow('La salida debe ser posterior a la entrada');
  });

  it('filtra historial por busqueda, tipo, metodo, sucursal y fechas', async () => {
    const { service, prisma } = createService();
    prisma.marcajeAsistencia.findMany.mockResolvedValueOnce([historyEntry()]);

    await service.findHistory(empresaId, {
      search: 'Ana',
      tipo: 'entrada',
      metodo: 'manual',
      sucursalId: '3',
      desde: '2026-08-24T00:00:00Z',
      hasta: '2026-08-24T23:59:59Z',
    });

    const findManyCalls = prisma.marcajeAsistencia.findMany.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    const findManyArg = findManyCalls[0][0];
    expect(findManyArg.where.empresaId).toBe(empresaId);
    expect(findManyArg.where.sucursalId).toBe(3n);
    expect(findManyArg.where.tipo).toBe('entrada');
    expect(findManyArg.where.metodo).toBe('manual');
    expect(findManyArg.where.fechaHora).toEqual({
      gte: new Date('2026-08-24T00:00:00Z'),
      lte: new Date('2026-08-24T23:59:59Z'),
    });
    expect(findManyArg.where.empleado).toBeDefined();
  });
});

type TestShift = {
  id: bigint;
  nombre: string;
  horaEntrada: string;
  horaSalida: string;
  diasLaborables: number[];
};

function employee(id: bigint, nombres: string, turno: TestShift | null) {
  return {
    id,
    empresaId: 10n,
    turnoId: turno?.id ?? null,
    tipoDocumento: 'dni',
    numeroDocumento: `0000000${id.toString()}`.slice(-8),
    nombres,
    apellidoPaterno: 'Test',
    apellidoMaterno: null,
    email: `${nombres.toLowerCase()}@test.com`,
    telefono: '999999999',
    estado: EmpleadoEstado.activo,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    turno,
  };
}

function entry(
  id: bigint,
  empleadoId: bigint,
  tipo: MarcajeAsistenciaTipo,
  fechaHora: string,
) {
  return {
    id,
    empresaId: 10n,
    empleadoId,
    turnoId: 1n,
    sucursalId: 3n,
    puntoQrId: 4n,
    tipo,
    metodo: MarcajeAsistenciaMetodo.qr,
    estado: MarcajeAsistenciaEstado.valido,
    fechaHora: new Date(fechaHora),
    latitud: -12,
    longitud: -77,
    precisionMetros: 10,
    distanciaMetros: 5,
    createdAt: new Date(fechaHora),
    turno: {
      id: 1n,
      nombre: 'Manana',
      horaEntrada: '09:00',
      horaSalida: '18:00',
    },
    sucursal: { id: 3n, nombre: 'Principal' },
    puntoQr: { id: 4n, nombre: 'Entrada principal' },
  };
}

function historyEntry() {
  return {
    ...entry(10n, 1n, MarcajeAsistenciaTipo.entrada, '2026-08-24T09:00:00Z'),
    metodo: MarcajeAsistenciaMetodo.manual,
    empleado: {
      id: 1n,
      nombres: 'Ana',
      apellidoPaterno: 'Test',
      apellidoMaterno: null,
      numeroDocumento: '00000001',
    },
  };
}
