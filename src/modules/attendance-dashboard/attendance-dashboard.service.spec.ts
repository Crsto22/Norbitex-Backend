import {
  EmpleadoEstado,
  PuntoQrAsistenciaEstado,
  TurnoEstado,
} from '@prisma/client';
import { AttendanceDashboardService } from './attendance-dashboard.service';

describe('AttendanceDashboardService', () => {
  const empresaId = 10n;
  const scope = { branchId: null, ownOperationsOnly: false, userId: 1n };

  function createService() {
    const prisma = {
      $transaction: jest.fn((input: Promise<unknown>[]) => Promise.all(input)),
      empleado: {
        count: jest
          .fn()
          .mockResolvedValueOnce(8)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(6)
          .mockResolvedValueOnce(2),
        groupBy: jest.fn().mockResolvedValue([
          { turnoId: 1n, _count: { _all: 4 } },
          { turnoId: 2n, _count: { _all: 2 } },
        ]),
      },
      turno: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, nombre: 'Manana' },
          { id: 2n, nombre: 'Tarde' },
        ]),
      },
      puntoQrAsistencia: {
        count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { sucursalId: 3n, _count: { _all: 2 } },
            { sucursalId: 4n, _count: { _all: 3 } },
          ])
          .mockResolvedValueOnce([
            { sucursalId: 3n, _count: { _all: 2 } },
            { sucursalId: 4n, _count: { _all: 3 } },
          ]),
      },
      sucursal: {
        findFirst: jest.fn().mockResolvedValue({ id: 3n }),
        findMany: jest.fn().mockResolvedValue([
          { id: 3n, nombre: 'Principal' },
          { id: 4n, nombre: 'Almacen' },
        ]),
      },
    };
    const cache = {
      key: jest.fn(() => 'attendance-dashboard:test'),
      getOrSet: jest.fn(
        (_key: string, _ttl: number, callback: () => Promise<unknown>) =>
          callback(),
      ),
    };
    const service = new AttendanceDashboardService(
      prisma as never,
      cache as never,
    );

    return { service, prisma };
  }

  it('responde metricas agregadas del dashboard de asistencias', async () => {
    const { service, prisma } = createService();

    await expect(
      service.find(empresaId, scope, {
        sucursalId: '3',
        dateFilter: 'today',
      }),
    ).resolves.toMatchObject({
      filters: { sucursalId: '3', dateFilter: 'today' },
      summary: {
        activeEmployees: 8,
        inactiveEmployees: 2,
        employeesWithShift: 6,
        employeesWithoutShift: 2,
        activeShifts: 3,
        activeQrPoints: 5,
      },
      employeesByStatus: [
        { name: 'Activos', value: 8 },
        { name: 'Inactivos', value: 2 },
      ],
      employeesByShift: [
        { turnoId: '1', name: 'Manana', value: 4 },
        { turnoId: '2', name: 'Tarde', value: 2 },
      ],
      qrPointsByBranch: [
        { sucursalId: '3', name: 'Principal', value: 2 },
        { sucursalId: '4', name: 'Almacen', value: 3 },
      ],
      alerts: {
        employeesWithoutShift: 2,
        inactiveShifts: 1,
        inactiveQrPoints: 1,
        branchesWithQrTotal: 2,
      },
    });
    expect(prisma.sucursal.findFirst).toHaveBeenCalledWith({
      where: { id: 3n, empresaId },
      select: { id: true },
    });
    expect(prisma.empleado.count).toHaveBeenCalledWith({
      where: { empresaId, estado: EmpleadoEstado.activo },
    });
    expect(prisma.turno.count).toHaveBeenCalledWith({
      where: { empresaId, estado: TurnoEstado.activo },
    });
    expect(prisma.puntoQrAsistencia.count).toHaveBeenCalledWith({
      where: {
        empresaId,
        sucursalId: 3n,
        estado: PuntoQrAsistenciaEstado.activo,
      },
    });
  });
});
