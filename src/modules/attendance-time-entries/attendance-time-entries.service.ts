import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmpleadoEstado,
  MarcajeAsistenciaEstado,
  MarcajeAsistenciaMetodo,
  MarcajeAsistenciaTipo,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateManualAttendanceTimeEntryDto } from './dto/create-manual-attendance-time-entry.dto';
import { FindAttendanceTimeEntryHistoryQueryDto } from './dto/find-attendance-time-entry-history-query.dto';
import {
  AttendanceTimeEntryRange,
  AttendanceTimeEntryStatus,
  FindAttendanceTimeEntriesQueryDto,
} from './dto/find-attendance-time-entries-query.dto';

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
  weekday: string;
  weekdayNumber: number;
  isFuture: boolean;
};

type EmployeeWithShift = Prisma.EmpleadoGetPayload<{
  include: {
    turno: {
      select: {
        id: true;
        nombre: true;
        horaEntrada: true;
        horaSalida: true;
        diasLaborables: true;
      };
    };
  };
}>;

type TimeEntryWithRelations = Prisma.MarcajeAsistenciaGetPayload<{
  include: {
    turno: {
      select: { id: true; nombre: true; horaEntrada: true; horaSalida: true };
    };
    sucursal: { select: { id: true; nombre: true } };
    puntoQr: { select: { id: true; nombre: true } };
  };
}>;

type HistoryEntryWithRelations = Prisma.MarcajeAsistenciaGetPayload<{
  include: {
    empleado: {
      select: {
        id: true;
        nombres: true;
        apellidoPaterno: true;
        apellidoMaterno: true;
        numeroDocumento: true;
      };
    };
    turno: {
      select: { id: true; nombre: true; horaEntrada: true; horaSalida: true };
    };
    sucursal: { select: { id: true; nombre: true } };
    puntoQr: { select: { id: true; nombre: true } };
  };
}>;

@Injectable()
export class AttendanceTimeEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint, query: FindAttendanceTimeEntriesQueryDto) {
    const range = query.range ?? '7days';
    const status = query.status ?? 'todos';
    const dateRange = this.getDateRange(range);
    const turnoId = this.parseOptionalId(query.turnoId, 'Turno invalido');
    const sucursalId = this.parseOptionalId(
      query.sucursalId,
      'Sucursal invalida',
    );
    const search = query.search?.trim();
    const employeeWhere: Prisma.EmpleadoWhereInput = {
      empresaId,
      estado: EmpleadoEstado.activo,
      ...(turnoId ? { turnoId } : {}),
      ...(search
        ? {
            OR: [
              { numeroDocumento: { contains: search, mode: 'insensitive' } },
              { nombres: { contains: search, mode: 'insensitive' } },
              { apellidoPaterno: { contains: search, mode: 'insensitive' } },
              { apellidoMaterno: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const employees = await this.prisma.empleado.findMany({
      where: employeeWhere,
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
    });
    const employeeIds = employees.map((employee) => employee.id);
    const entries = employeeIds.length
      ? await this.prisma.marcajeAsistencia.findMany({
          where: {
            empresaId,
            empleadoId: { in: employeeIds },
            fechaHora: { gte: dateRange.start, lte: dateRange.end },
            estado: { not: MarcajeAsistenciaEstado.anulado },
            ...(sucursalId ? { sucursalId } : {}),
          },
          include: {
            turno: {
              select: {
                id: true,
                nombre: true,
                horaEntrada: true,
                horaSalida: true,
              },
            },
            sucursal: { select: { id: true, nombre: true } },
            puntoQr: { select: { id: true, nombre: true } },
          },
          orderBy: { fechaHora: 'asc' },
        })
      : [];

    const days = this.buildDays(dateRange.start, dateRange.end);
    const entriesByEmployeeAndDay = this.groupEntries(entries);
    const rows = employees
      .map((employee) =>
        this.buildEmployeeRow(employee, days, entriesByEmployeeAndDay),
      )
      .filter((row) => this.rowMatchesStatus(row, status));

    return {
      range,
      status,
      filters: {
        sucursalId: sucursalId?.toString() ?? null,
        turnoId: turnoId?.toString() ?? null,
      },
      summary: this.buildSummary(rows),
      days,
      rows,
    };
  }

  async findHistory(
    empresaId: bigint,
    query: FindAttendanceTimeEntryHistoryQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const empleadoId = this.parseOptionalId(
      query.empleadoId,
      'Trabajador invalido',
    );
    const sucursalId = this.parseOptionalId(
      query.sucursalId,
      'Sucursal invalida',
    );
    const fechaHora = this.buildHistoryDateFilter(query.desde, query.hasta);
    const search = query.search?.trim();
    const where: Prisma.MarcajeAsistenciaWhereInput = {
      empresaId,
      ...(empleadoId ? { empleadoId } : {}),
      ...(sucursalId ? { sucursalId } : {}),
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.metodo ? { metodo: query.metodo } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(fechaHora ? { fechaHora } : {}),
      ...(search
        ? {
            empleado: {
              OR: [
                { numeroDocumento: { contains: search, mode: 'insensitive' } },
                { nombres: { contains: search, mode: 'insensitive' } },
                { apellidoPaterno: { contains: search, mode: 'insensitive' } },
                { apellidoMaterno: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.marcajeAsistencia.findMany({
        where,
        include: this.historyInclude,
        orderBy: { fechaHora: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.marcajeAsistencia.count({ where }),
    ]);

    return {
      data: entries.map((entry) => this.toHistoryResponse(entry)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async createManual(
    empresaId: bigint,
    dto: CreateManualAttendanceTimeEntryDto,
  ) {
    const empleadoId = this.parseRequiredId(
      dto.empleadoId,
      'Trabajador invalido',
    );
    const sucursalId = this.parseOptionalId(
      dto.sucursalId,
      'Sucursal invalida',
    );
    const fechaHora = new Date(dto.fechaHora);
    if (Number.isNaN(fechaHora.getTime())) {
      throw new BadRequestException('Fecha de marcacion invalida');
    }
    if (fechaHora > new Date()) {
      throw new BadRequestException('No se permiten marcaciones futuras');
    }

    const employee = await this.prisma.empleado.findFirst({
      where: { id: empleadoId, empresaId, estado: EmpleadoEstado.activo },
      select: { id: true, turnoId: true },
    });
    if (!employee) {
      throw new NotFoundException('Trabajador activo no encontrado');
    }

    if (sucursalId) {
      const branch = await this.prisma.sucursal.findFirst({
        where: { id: sucursalId, empresaId },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException('Sucursal no encontrada');
      }
    }

    await this.assertManualEntryIsAllowed(
      empresaId,
      empleadoId,
      dto.tipo,
      fechaHora,
    );

    const entry = await this.prisma.marcajeAsistencia.create({
      data: {
        empresaId,
        empleadoId,
        turnoId: employee.turnoId,
        sucursalId,
        puntoQrId: null,
        tipo: dto.tipo,
        metodo: MarcajeAsistenciaMetodo.manual,
        estado: MarcajeAsistenciaEstado.valido,
        fechaHora,
        latitud: null,
        longitud: null,
        precisionMetros: null,
        distanciaMetros: null,
      },
      include: this.historyInclude,
    });

    return this.toHistoryResponse(entry);
  }

  private readonly historyInclude = {
    empleado: {
      select: {
        id: true,
        nombres: true,
        apellidoPaterno: true,
        apellidoMaterno: true,
        numeroDocumento: true,
      },
    },
    turno: {
      select: { id: true, nombre: true, horaEntrada: true, horaSalida: true },
    },
    sucursal: { select: { id: true, nombre: true } },
    puntoQr: { select: { id: true, nombre: true } },
  } satisfies Prisma.MarcajeAsistenciaInclude;

  private buildEmployeeRow(
    employee: EmployeeWithShift,
    days: ReturnType<typeof this.buildDays>,
    entriesMap: Map<string, TimeEntryWithRelations[]>,
  ) {
    return {
      employee: {
        id: employee.id.toString(),
        nombres: employee.nombres,
        apellidoPaterno: employee.apellidoPaterno,
        apellidoMaterno: employee.apellidoMaterno,
        numeroDocumento: employee.numeroDocumento,
      },
      turno: employee.turno
        ? {
            id: employee.turno.id.toString(),
            nombre: employee.turno.nombre,
            horaEntrada: employee.turno.horaEntrada,
            horaSalida: employee.turno.horaSalida,
          }
        : null,
      days: days.map((day) =>
        this.buildDayStatus(
          employee,
          day,
          entriesMap.get(`${employee.id.toString()}:${day.date}`) ?? [],
        ),
      ),
    };
  }

  private buildDayStatus(
    employee: EmployeeWithShift,
    day: AttendanceDay,
    entries: TimeEntryWithRelations[],
  ) {
    const entrada = entries.find(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.entrada,
    );
    const salida = [...entries]
      .reverse()
      .find((entry) => entry.tipo === MarcajeAsistenciaTipo.salida);
    const shift = employee.turno;
    let status: AttendanceDayStatus = 'sin_turno';

    if (day.isFuture) {
      status = 'pendiente';
    } else if (!shift) {
      status = 'sin_turno';
    } else if (!shift.diasLaborables.includes(day.weekdayNumber)) {
      status = 'descanso';
    } else if (entrada && salida) {
      status =
        this.formatTime(entrada.fechaHora) > shift.horaEntrada
          ? 'tardanza'
          : 'asistencia';
    } else if (entrada || salida) {
      status = 'incompleto';
    } else {
      status = 'falta';
    }

    const referenceEntry = entrada ?? salida ?? entries[0];

    return {
      date: day.date,
      weekday: day.weekday,
      status,
      entrada: entrada ? this.toEntryResponse(entrada) : null,
      salida: salida ? this.toEntryResponse(salida) : null,
      turno: shift
        ? {
            id: shift.id.toString(),
            nombre: shift.nombre,
            horaEntrada: shift.horaEntrada,
            horaSalida: shift.horaSalida,
          }
        : null,
      sucursal: referenceEntry?.sucursal
        ? {
            id: referenceEntry.sucursal.id.toString(),
            nombre: referenceEntry.sucursal.nombre,
          }
        : null,
      puntoQr: referenceEntry?.puntoQr
        ? {
            id: referenceEntry.puntoQr.id.toString(),
            nombre: referenceEntry.puntoQr.nombre,
          }
        : null,
    };
  }

  private buildSummary(
    rows: Array<{ days: Array<{ status: AttendanceDayStatus }> }>,
  ) {
    return rows.reduce(
      (summary, row) => {
        for (const day of row.days) {
          if (day.status === 'asistencia') summary.asistencias += 1;
          if (day.status === 'falta') summary.faltas += 1;
          if (day.status === 'tardanza') summary.tardanzas += 1;
          if (day.status === 'incompleto') summary.incompletos += 1;
        }
        return summary;
      },
      { asistencias: 0, faltas: 0, tardanzas: 0, incompletos: 0 },
    );
  }

  private rowMatchesStatus(
    row: { days: Array<{ status: AttendanceDayStatus }> },
    status: AttendanceTimeEntryStatus,
  ) {
    if (status === 'todos') return true;
    const statusMap: Record<
      Exclude<AttendanceTimeEntryStatus, 'todos'>,
      AttendanceDayStatus
    > = {
      asistencias: 'asistencia',
      faltas: 'falta',
      tardanzas: 'tardanza',
      incompletos: 'incompleto',
    };

    return row.days.some((day) => day.status === statusMap[status]);
  }

  private groupEntries(entries: TimeEntryWithRelations[]) {
    const map = new Map<string, TimeEntryWithRelations[]>();
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
      const weekdayNumber = this.weekdayNumber(cursor);
      days.push({
        date: this.dateKey(cursor),
        weekday: this.weekdayLabel(cursor),
        weekdayNumber,
        isFuture: cursor > today,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }

  private getDateRange(range: AttendanceTimeEntryRange) {
    const now = new Date();
    if (range === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      return { start, end };
    }

    const days = range === '7days' ? 7 : range === '14days' ? 14 : 21;
    const currentMonday = this.startOfWeek(now);
    const start = new Date(currentMonday);
    start.setDate(currentMonday.getDate() - (days - 7));
    const end = new Date(currentMonday);
    end.setDate(currentMonday.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private startOfWeek(date: Date) {
    const start = this.startOfDay(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return start;
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

  private weekdayLabel(date: Date) {
    return new Intl.DateTimeFormat('es-PE', { weekday: 'short' })
      .format(date)
      .replace('.', '');
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

  private async assertManualEntryIsAllowed(
    empresaId: bigint,
    empleadoId: bigint,
    tipo: MarcajeAsistenciaTipo,
    fechaHora: Date,
  ) {
    const start = this.startOfDay(fechaHora);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const entries = await this.prisma.marcajeAsistencia.findMany({
      where: {
        empresaId,
        empleadoId,
        fechaHora: { gte: start, lte: end },
        estado: { not: MarcajeAsistenciaEstado.anulado },
      },
      select: { tipo: true, fechaHora: true },
      orderBy: { fechaHora: 'asc' },
    });

    if (entries.some((entry) => entry.tipo === tipo)) {
      throw new ConflictException(
        tipo === MarcajeAsistenciaTipo.entrada
          ? 'Ya existe una entrada para este dia'
          : 'Ya existe una salida para este dia',
      );
    }

    const entrada = entries.find(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.entrada,
    );
    const salida = entries.find(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.salida,
    );
    if (tipo === MarcajeAsistenciaTipo.salida && entrada) {
      if (fechaHora <= entrada.fechaHora) {
        throw new BadRequestException(
          'La salida debe ser posterior a la entrada',
        );
      }
    }
    if (tipo === MarcajeAsistenciaTipo.entrada && salida) {
      if (fechaHora >= salida.fechaHora) {
        throw new BadRequestException(
          'La entrada debe ser anterior a la salida',
        );
      }
    }
  }

  private buildHistoryDateFilter(desde?: string, hasta?: string) {
    const filter: Prisma.DateTimeFilter = {};
    if (desde) {
      const start = new Date(desde);
      if (Number.isNaN(start.getTime())) {
        throw new BadRequestException('Fecha desde invalida');
      }
      filter.gte = start;
    }
    if (hasta) {
      const end = new Date(hasta);
      if (Number.isNaN(end.getTime())) {
        throw new BadRequestException('Fecha hasta invalida');
      }
      filter.lte = end;
    }
    return Object.keys(filter).length ? filter : null;
  }

  private parseRequiredId(value: string, message: string) {
    const cleanValue = value.trim();
    if (!cleanValue) throw new BadRequestException(message);
    try {
      return BigInt(cleanValue);
    } catch {
      throw new BadRequestException(message);
    }
  }

  private parseOptionalId(value: string | undefined, message: string) {
    const cleanValue = value?.trim();
    if (!cleanValue || cleanValue === 'todos' || cleanValue === 'all') {
      return null;
    }
    try {
      return BigInt(cleanValue);
    } catch {
      throw new BadRequestException(message);
    }
  }

  private toEntryResponse(entry: TimeEntryWithRelations) {
    return {
      id: entry.id.toString(),
      empleadoId: entry.empleadoId.toString(),
      turnoId: entry.turnoId?.toString() ?? null,
      sucursalId: entry.sucursalId?.toString() ?? null,
      puntoQrId: entry.puntoQrId?.toString() ?? null,
      tipo: entry.tipo,
      metodo: entry.metodo,
      estado: entry.estado,
      fechaHora: entry.fechaHora.toISOString(),
      hora: this.formatTime(entry.fechaHora),
      latitud: entry.latitud,
      longitud: entry.longitud,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toHistoryResponse(entry: HistoryEntryWithRelations) {
    return {
      ...this.toEntryResponse(entry),
      empleado: {
        id: entry.empleado.id.toString(),
        nombres: entry.empleado.nombres,
        apellidoPaterno: entry.empleado.apellidoPaterno,
        apellidoMaterno: entry.empleado.apellidoMaterno,
        numeroDocumento: entry.empleado.numeroDocumento,
      },
      turno: entry.turno
        ? {
            id: entry.turno.id.toString(),
            nombre: entry.turno.nombre,
            horaEntrada: entry.turno.horaEntrada,
            horaSalida: entry.turno.horaSalida,
          }
        : null,
      sucursal: entry.sucursal
        ? { id: entry.sucursal.id.toString(), nombre: entry.sucursal.nombre }
        : null,
      puntoQr: entry.puntoQr
        ? { id: entry.puntoQr.id.toString(), nombre: entry.puntoQr.nombre }
        : null,
    };
  }
}
