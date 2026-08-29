import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmpleadoEstado, Prisma, Turno, TurnoEstado } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignShiftEmployeesDto } from './dto/assign-shift-employees.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { FindShiftsQueryDto } from './dto/find-shifts-query.dto';
import { UpdateShiftStatusDto } from './dto/update-shift-status.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

type ShiftData = {
  nombre: string;
  horaEntrada: string;
  horaSalida: string;
  diasLaborables: number[];
  estado: TurnoEstado;
};

type ShiftInput = CreateShiftDto & {
  estado?: 'activo' | 'inactivo';
};

type ShiftWithCount = Turno & {
  _count?: {
    empleados: number;
  };
};

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(empresaId: bigint, query: FindShiftsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.TurnoWhereInput = {
      empresaId,
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search ? { nombre: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [shifts, total, activeTotal, inactiveTotal, assignedEmployeesTotal] =
      await this.prisma.$transaction([
        this.prisma.turno.findMany({
          where,
          include: { _count: { select: { empleados: true } } },
          orderBy: [{ estado: 'asc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.turno.count({ where }),
        this.prisma.turno.count({
          where: { empresaId, estado: TurnoEstado.activo },
        }),
        this.prisma.turno.count({
          where: { empresaId, estado: TurnoEstado.inactivo },
        }),
        this.prisma.empleado.count({
          where: { empresaId, turnoId: { not: null } },
        }),
      ]);

    return {
      data: shifts.map((shift) => this.toResponse(shift)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        activeTotal,
        inactiveTotal,
        assignedEmployeesTotal,
      },
    };
  }

  async create(empresaId: bigint, dto: CreateShiftDto) {
    const data = this.normalizeData(dto);

    try {
      const shift = await this.prisma.turno.create({
        data: { empresaId, ...data },
        include: { _count: { select: { empleados: true } } },
      });

      return this.toResponse(shift);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findOne(empresaId: bigint, id: bigint) {
    return this.toResponse(await this.ensureShiftExists(empresaId, id));
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateShiftDto) {
    const current = await this.ensureShiftExists(empresaId, id);
    const data = this.normalizeData({
      nombre: dto.nombre ?? current.nombre,
      horaEntrada: dto.horaEntrada ?? current.horaEntrada,
      horaSalida: dto.horaSalida ?? current.horaSalida,
      diasLaborables: dto.diasLaborables ?? current.diasLaborables,
      estado: dto.estado ?? current.estado,
    });

    try {
      const shift = await this.prisma.turno.update({
        where: { id },
        data,
        include: { _count: { select: { empleados: true } } },
      });

      return this.toResponse(shift);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateStatus(empresaId: bigint, id: bigint, dto: UpdateShiftStatusDto) {
    await this.ensureShiftExists(empresaId, id);

    const shift = await this.prisma.turno.update({
      where: { id },
      data: { estado: dto.estado },
      include: { _count: { select: { empleados: true } } },
    });

    return this.toResponse(shift);
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureShiftExists(empresaId, id);

    const shift = await this.prisma.turno.update({
      where: { id },
      data: { estado: TurnoEstado.inactivo },
      include: { _count: { select: { empleados: true } } },
    });

    return this.toResponse(shift);
  }

  async assignEmployees(
    empresaId: bigint,
    id: bigint,
    dto: AssignShiftEmployeesDto,
  ) {
    const shift = await this.ensureShiftExists(empresaId, id);
    if (shift.estado !== TurnoEstado.activo) {
      throw new ConflictException(
        'Solo puedes asignar personal a turnos activos',
      );
    }

    const employeeIds = this.parseUniqueIds(dto.employeeIds);
    if (employeeIds.length) {
      const employees = await this.prisma.empleado.findMany({
        where: {
          empresaId,
          id: { in: employeeIds },
          estado: EmpleadoEstado.activo,
        },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        throw new BadRequestException(
          'Selecciona solo trabajadores activos de esta empresa',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.empleado.updateMany({
        where: { empresaId, turnoId: id },
        data: { turnoId: null },
      });

      if (employeeIds.length) {
        await tx.empleado.updateMany({
          where: { empresaId, id: { in: employeeIds } },
          data: { turnoId: id },
        });
      }

      return tx.turno.findFirstOrThrow({
        where: { empresaId, id },
        include: { _count: { select: { empleados: true } } },
      });
    });

    return this.toResponse(updated);
  }

  private async ensureShiftExists(empresaId: bigint, id: bigint) {
    const shift = await this.prisma.turno.findFirst({
      where: { id, empresaId },
      include: { _count: { select: { empleados: true } } },
    });

    if (!shift) {
      throw new NotFoundException('Turno no encontrado');
    }

    return shift;
  }

  private normalizeData(dto: ShiftInput): ShiftData {
    const nombre = dto.nombre?.trim().replace(/\s+/g, ' ');
    if (!nombre) {
      throw new BadRequestException('Ingresa el nombre del turno');
    }

    const horaEntrada = this.cleanTime(dto.horaEntrada, 'Ingresa hora entrada');
    const horaSalida = this.cleanTime(dto.horaSalida, 'Ingresa hora salida');
    if (horaSalida <= horaEntrada) {
      throw new BadRequestException(
        'La hora de salida debe ser mayor a la hora de entrada',
      );
    }

    const diasLaborables = [...new Set(dto.diasLaborables ?? [])].sort(
      (left, right) => left - right,
    );
    if (
      !diasLaborables.length ||
      diasLaborables.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      throw new BadRequestException('Selecciona dias laborables validos');
    }

    return {
      nombre,
      horaEntrada,
      horaSalida,
      diasLaborables,
      estado:
        dto.estado === TurnoEstado.inactivo
          ? TurnoEstado.inactivo
          : TurnoEstado.activo,
    };
  }

  private cleanTime(value: string | undefined, message: string) {
    const time = value?.trim();
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      throw new BadRequestException(message);
    }

    const [hour, minute] = time.split(':').map(Number);
    if (hour > 23 || minute > 59) {
      throw new BadRequestException('Horario invalido');
    }

    return time;
  }

  private parseUniqueIds(values: string[]) {
    try {
      return [...new Set(values.map((value) => BigInt(value)))];
    } catch {
      throw new BadRequestException('Trabajador invalido');
    }
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );
    const safeMaxLimit =
      Number.isInteger(maxLimit) && maxLimit > 0 ? maxLimit : defaultLimit;

    return Number.isInteger(defaultLimit) && defaultLimit > 0
      ? Math.min(defaultLimit, safeMaxLimit)
      : 12;
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un turno con ese nombre');
    }

    throw error;
  }

  private toResponse(shift: ShiftWithCount) {
    return {
      id: shift.id.toString(),
      empresaId: shift.empresaId.toString(),
      nombre: shift.nombre,
      horaEntrada: shift.horaEntrada,
      horaSalida: shift.horaSalida,
      diasLaborables: shift.diasLaborables,
      estado: shift.estado,
      assignedEmployeesTotal: shift._count?.empleados ?? 0,
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString(),
    };
  }
}
