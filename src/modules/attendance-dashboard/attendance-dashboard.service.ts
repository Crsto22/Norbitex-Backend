import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EmpleadoEstado,
  MarcajeAsistenciaEstado,
  MarcajeAsistenciaTipo,
  Prisma,
  PuntoQrAsistenciaEstado,
  SucursalEstado,
  TurnoEstado,
} from '@prisma/client';
import { ResponseCacheService } from '../../common/cache/response-cache.service';
import {
  resolveScopedBranchId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AttendanceDashboardDateFilter,
  FindAttendanceDashboardQueryDto,
} from './dto/find-attendance-dashboard-query.dto';

type CountGroup = {
  _count?: true | { _all?: number };
};

type AttendanceDayStatus =
  | 'asistencia'
  | 'falta'
  | 'tardanza'
  | 'incompleto'
  | 'descanso'
  | 'sin_turno'
  | 'pendiente';

type AttendanceDay = {
  date: string;
  label: string;
  weekdayNumber: number;
  isFuture: boolean;
};

@Injectable()
export class AttendanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ResponseCacheService,
  ) {}

  async find(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindAttendanceDashboardQueryDto,
  ) {
    return this.cache.getOrSet(
      this.cache.key('attendance-dashboard', empresaId, scope, query),
      30_000,
      () => this.findUncached(empresaId, scope, query),
    );
  }

  private async findUncached(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindAttendanceDashboardQueryDto,
  ) {
    const sucursalId = resolveScopedBranchId(scope, query.sucursalId);
    await this.validateSucursalId(empresaId, sucursalId);

    const selectedRange = this.getDateFilterRange(query.dateFilter ?? 'today');
    const qrWhere = {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
    } satisfies Prisma.PuntoQrAsistenciaWhereInput;

    const [
      activeEmployees,
      inactiveEmployees,
      employeesWithShift,
      employeesWithoutShift,
      activeShifts,
      inactiveShifts,
      activeQrPoints,
      inactiveQrPoints,
      branchesWithQrGroups,
      employeesByShiftGroups,
      qrByBranchGroups,
      employees,
      timeEntries,
      entriesByBranchGroups,
    ] = await this.prisma.$transaction([
      this.prisma.empleado.count({
        where: { empresaId, estado: EmpleadoEstado.activo },
      }),
      this.prisma.empleado.count({
        where: { empresaId, estado: EmpleadoEstado.inactivo },
      }),
      this.prisma.empleado.count({
        where: {
          empresaId,
          estado: EmpleadoEstado.activo,
          turnoId: { not: null },
        },
      }),
      this.prisma.empleado.count({
        where: {
          empresaId,
          estado: EmpleadoEstado.activo,
          turnoId: null,
        },
      }),
      this.prisma.turno.count({
        where: { empresaId, estado: TurnoEstado.activo },
      }),
      this.prisma.turno.count({
        where: { empresaId, estado: TurnoEstado.inactivo },
      }),
      this.prisma.puntoQrAsistencia.count({
        where: { ...qrWhere, estado: PuntoQrAsistenciaEstado.activo },
      }),
      this.prisma.puntoQrAsistencia.count({
        where: { ...qrWhere, estado: PuntoQrAsistenciaEstado.inactivo },
      }),
      this.prisma.puntoQrAsistencia.groupBy({
        by: ['sucursalId'],
        where: { ...qrWhere, estado: PuntoQrAsistenciaEstado.activo },
        _count: { _all: true },
        orderBy: { sucursalId: 'asc' },
      }),
      this.prisma.empleado.groupBy({
        by: ['turnoId'],
        where: {
          empresaId,
          estado: EmpleadoEstado.activo,
          turnoId: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { turnoId: 'desc' } },
        take: 5,
      }),
      this.prisma.puntoQrAsistencia.groupBy({
        by: ['sucursalId'],
        where: { ...qrWhere, estado: PuntoQrAsistenciaEstado.activo },
        _count: { _all: true },
        orderBy: { _count: { sucursalId: 'desc' } },
        take: 5,
      }),
      this.prisma.empleado.findMany({
        where: { empresaId, estado: EmpleadoEstado.activo },
        include: {
          turno: {
            select: {
              id: true,
              nombre: true,
              horaEntrada: true,
              horaSalida: true,
              diasLaborables: true,
            },
          },
        },
        orderBy: [{ nombres: 'asc' }, { apellidoPaterno: 'asc' }],
      }),
      this.prisma.marcajeAsistencia.findMany({
        where: {
          empresaId,
          fechaHora: { gte: selectedRange.start, lte: selectedRange.end },
          estado: { not: MarcajeAsistenciaEstado.anulado },
          ...(sucursalId ? { sucursalId } : {}),
        },
        include: {
          sucursal: { select: { id: true, nombre: true } },
        },
        orderBy: { fechaHora: 'asc' },
      }),
      this.prisma.marcajeAsistencia.groupBy({
        by: ['sucursalId'],
        where: {
          empresaId,
          fechaHora: { gte: selectedRange.start, lte: selectedRange.end },
          estado: { not: MarcajeAsistenciaEstado.anulado },
          sucursalId: { not: null },
          ...(sucursalId ? { sucursalId } : {}),
        },
        _count: { _all: true },
        orderBy: { _count: { sucursalId: 'desc' } },
        take: 5,
      }),
    ]);

    const attendance = this.buildAttendanceData(
      employees,
      timeEntries,
      selectedRange.start,
      selectedRange.end,
    );
    const [employeesByShift, qrPointsByBranch, attendanceByBranch] =
      await Promise.all([
        this.buildEmployeesByShift(empresaId, employeesByShiftGroups),
        this.buildQrPointsByBranch(empresaId, qrByBranchGroups),
        this.buildAttendanceByBranch(empresaId, entriesByBranchGroups),
      ]);

    return {
      filters: {
        sucursalId: sucursalId?.toString() ?? null,
        dateFilter: query.dateFilter ?? 'today',
        range: {
          start: selectedRange.start.toISOString(),
          end: selectedRange.end.toISOString(),
        },
      },
      summary: {
        attendances: attendance.summary.asistencias,
        absences: attendance.summary.faltas,
        lateArrivals: attendance.summary.tardanzas,
        incompleteEntries: attendance.summary.incompletos,
        activeEmployees,
        inactiveEmployees,
        employeesWithShift,
        employeesWithoutShift,
        activeShifts,
        activeQrPoints,
      },
      employeesByStatus: [
        { name: 'Activos', value: activeEmployees, color: '#10b981' },
        { name: 'Inactivos', value: inactiveEmployees, color: '#f97316' },
      ],
      attendanceByStatus: [
        {
          name: 'Asistencias',
          value: attendance.summary.asistencias,
          color: '#10b981',
        },
        { name: 'Faltas', value: attendance.summary.faltas, color: '#ef4444' },
        {
          name: 'Tardanzas',
          value: attendance.summary.tardanzas,
          color: '#f97316',
        },
        {
          name: 'Incompletos',
          value: attendance.summary.incompletos,
          color: '#eab308',
        },
      ],
      attendanceTrend: attendance.trend,
      attendanceByBranch,
      employeesByShift,
      qrPointsByBranch,
      alerts: {
        employeesWithoutShift,
        inactiveShifts,
        inactiveQrPoints,
        branchesWithQrTotal: branchesWithQrGroups.length,
      },
    };
  }

  private async validateSucursalId(empresaId: bigint, id: bigint | null) {
    if (!id) return;

    const branch = await this.prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException('Sucursal no encontrada');
    }
  }

  private async buildEmployeesByShift(
    empresaId: bigint,
    groups: Array<
      {
        turnoId: bigint | null;
      } & CountGroup
    >,
  ) {
    const shiftIds = groups.flatMap((group) =>
      group.turnoId ? [group.turnoId] : [],
    );
    const shifts = await this.prisma.turno.findMany({
      where: { empresaId, id: { in: shiftIds } },
      select: { id: true, nombre: true },
    });
    const shiftMap = new Map(
      shifts.map((shift) => [shift.id.toString(), shift.nombre]),
    );

    return groups.map((group) => ({
      turnoId: group.turnoId?.toString() ?? null,
      name: group.turnoId
        ? (shiftMap.get(group.turnoId.toString()) ?? 'Turno')
        : 'Sin turno',
      value: this.groupCount(group),
    }));
  }

  private async buildQrPointsByBranch(
    empresaId: bigint,
    groups: Array<
      {
        sucursalId: bigint;
      } & CountGroup
    >,
  ) {
    const branchIds = groups.map((group) => group.sucursalId);
    const branches = await this.prisma.sucursal.findMany({
      where: {
        empresaId,
        id: { in: branchIds },
        estado: SucursalEstado.activo,
      },
      select: { id: true, nombre: true },
    });
    const branchMap = new Map(
      branches.map((branch) => [branch.id.toString(), branch.nombre]),
    );

    return groups.map((group) => ({
      sucursalId: group.sucursalId.toString(),
      name: branchMap.get(group.sucursalId.toString()) ?? 'Sucursal',
      value: this.groupCount(group),
    }));
  }

  private async buildAttendanceByBranch(
    empresaId: bigint,
    groups: Array<
      {
        sucursalId: bigint | null;
      } & CountGroup
    >,
  ) {
    const branchIds = groups.flatMap((group) =>
      group.sucursalId ? [group.sucursalId] : [],
    );
    const branches = await this.prisma.sucursal.findMany({
      where: { empresaId, id: { in: branchIds } },
      select: { id: true, nombre: true },
    });
    const branchMap = new Map(
      branches.map((branch) => [branch.id.toString(), branch.nombre]),
    );

    return groups.map((group) => ({
      sucursalId: group.sucursalId?.toString() ?? null,
      name: group.sucursalId
        ? (branchMap.get(group.sucursalId.toString()) ?? 'Sucursal')
        : 'Sin sucursal',
      value: this.groupCount(group),
    }));
  }

  private buildAttendanceData(
    employees: Array<{
      id: bigint;
      turno: {
        id: bigint;
        nombre: string;
        horaEntrada: string;
        horaSalida: string;
        diasLaborables: number[];
      } | null;
    }>,
    entries: Array<{
      empleadoId: bigint;
      tipo: MarcajeAsistenciaTipo;
      fechaHora: Date;
    }>,
    start: Date,
    end: Date,
  ) {
    const days = this.buildDays(start, end);
    const entriesByEmployeeAndDay = this.groupEntries(entries);
    const trend = days.map((day) => ({
      date: day.date,
      label: day.label,
      asistencias: 0,
      faltas: 0,
      tardanzas: 0,
      incompletos: 0,
    }));
    const trendMap = new Map(trend.map((day) => [day.date, day]));
    const summary = {
      asistencias: 0,
      faltas: 0,
      tardanzas: 0,
      incompletos: 0,
    };

    for (const employee of employees) {
      for (const day of days) {
        const status = this.getAttendanceStatus(
          employee,
          day,
          entriesByEmployeeAndDay.get(
            `${employee.id.toString()}:${day.date}`,
          ) ?? [],
        );
        const trendItem = trendMap.get(day.date);

        if (status === 'asistencia') {
          summary.asistencias += 1;
          if (trendItem) trendItem.asistencias += 1;
        }
        if (status === 'falta') {
          summary.faltas += 1;
          if (trendItem) trendItem.faltas += 1;
        }
        if (status === 'tardanza') {
          summary.tardanzas += 1;
          if (trendItem) trendItem.tardanzas += 1;
        }
        if (status === 'incompleto') {
          summary.incompletos += 1;
          if (trendItem) trendItem.incompletos += 1;
        }
      }
    }

    return { summary, trend };
  }

  private getAttendanceStatus(
    employee: {
      turno: {
        horaEntrada: string;
        diasLaborables: number[];
      } | null;
    },
    day: AttendanceDay,
    entries: Array<{ tipo: MarcajeAsistenciaTipo; fechaHora: Date }>,
  ): AttendanceDayStatus {
    const entrada = entries.find(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.entrada,
    );
    const salida = entries.find(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.salida,
    );

    if (day.isFuture) return 'pendiente';
    if (!employee.turno) return 'sin_turno';
    if (!employee.turno.diasLaborables.includes(day.weekdayNumber)) {
      return 'descanso';
    }
    if (entrada && salida) {
      return this.formatTime(entrada.fechaHora) > employee.turno.horaEntrada
        ? 'tardanza'
        : 'asistencia';
    }
    if (entrada || salida) return 'incompleto';
    return 'falta';
  }

  private groupEntries(
    entries: Array<{
      empleadoId: bigint;
      tipo: MarcajeAsistenciaTipo;
      fechaHora: Date;
    }>,
  ) {
    const map = new Map<
      string,
      Array<{ tipo: MarcajeAsistenciaTipo; fechaHora: Date }>
    >();
    for (const entry of entries) {
      const key = `${entry.empleadoId.toString()}:${this.dateKey(entry.fechaHora)}`;
      const current = map.get(key) ?? [];
      current.push(entry);
      map.set(key, current);
    }
    return map;
  }

  private buildDays(start: Date, end: Date) {
    const today = this.startOfDay(new Date());
    const days: AttendanceDay[] = [];
    const cursor = this.startOfDay(start);
    const last = this.startOfDay(end);

    while (cursor <= last) {
      days.push({
        date: this.dateKey(cursor),
        label: new Intl.DateTimeFormat('es-PE', {
          day: '2-digit',
          month: 'short',
        })
          .format(cursor)
          .replace('.', ''),
        weekdayNumber: this.weekdayNumber(cursor),
        isFuture: cursor > today,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }

  private startOfDay(date: Date) {
    const cleanDate = new Date(date);
    cleanDate.setHours(0, 0, 0, 0);
    return cleanDate;
  }

  private weekdayNumber(date: Date) {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  private dateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private formatTime(date: Date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
  }

  private groupCount(group: CountGroup) {
    return typeof group._count === 'object' ? (group._count._all ?? 0) : 0;
  }

  private getDateFilterRange(filter: AttendanceDashboardDateFilter) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (filter !== 'today') {
      const days = filter === '7days' ? 7 : filter === '14days' ? 14 : 30;
      start.setDate(start.getDate() - (days - 1));
    }

    return { start, end: now };
  }
}
