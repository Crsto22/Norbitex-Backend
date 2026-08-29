import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Empleado,
  EmpleadoEstado,
  EmpleadoTipoDocumento,
  Prisma,
  TurnoEstado,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { FindEmployeesQueryDto } from './dto/find-employees-query.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

type EmployeeData = {
  turnoId: bigint | null;
  tipoDocumento: EmpleadoTipoDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  email: string;
  telefono: string;
  estado: EmpleadoEstado;
};

type EmployeeInput = CreateEmployeeDto & {
  estado?: 'activo' | 'inactivo';
};

type EmployeeWithShift = Empleado & {
  turno?: {
    id: bigint;
    nombre: string;
    horaEntrada: string;
    horaSalida: string;
  } | null;
};

const activationTokenTtlDays = 7;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  async findAll(empresaId: bigint, query: FindEmployeesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.EmpleadoWhereInput = {
      empresaId,
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search
        ? {
            OR: [
              { numeroDocumento: { contains: search, mode: 'insensitive' } },
              { nombres: { contains: search, mode: 'insensitive' } },
              { apellidoPaterno: { contains: search, mode: 'insensitive' } },
              { apellidoMaterno: { contains: search, mode: 'insensitive' } },
              { telefono: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [employees, total, activeTotal, inactiveTotal, dniTotal] =
      await this.prisma.$transaction([
        this.prisma.empleado.findMany({
          where,
          include: {
            turno: {
              select: {
                id: true,
                nombre: true,
                horaEntrada: true,
                horaSalida: true,
              },
            },
          },
          orderBy: [{ estado: 'asc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.empleado.count({ where }),
        this.prisma.empleado.count({
          where: { empresaId, estado: EmpleadoEstado.activo },
        }),
        this.prisma.empleado.count({
          where: { empresaId, estado: EmpleadoEstado.inactivo },
        }),
        this.prisma.empleado.count({
          where: { empresaId, tipoDocumento: EmpleadoTipoDocumento.dni },
        }),
      ]);

    return {
      data: employees.map((employee) => this.toResponse(employee)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        activeTotal,
        inactiveTotal,
        dniTotal,
      },
    };
  }

  async create(empresaId: bigint, dto: CreateEmployeeDto) {
    const data = this.normalizeData(dto);
    await this.assertEmailAvailable(data.email);
    await this.assertShiftAvailable(empresaId, data.turnoId);
    const activation = this.createActivationToken();

    try {
      const employee = await this.prisma.$transaction(
        async (tx) => {
          if (data.estado === EmpleadoEstado.activo) {
            await this.plansService.assertResourceLimits(tx, empresaId, {
              attendanceEmployees: 1,
            });
          }
          return tx.empleado.create({
            data: {
              empresaId,
              ...data,
              activationTokenHash: activation.hash,
              activationTokenExpiresAt: activation.expiresAt,
              activationTokenUsedAt: null,
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
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.toResponse(employee, activation.token);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async generateAccessToken(empresaId: bigint, id: bigint) {
    const current = await this.ensureEmployeeExists(empresaId, id);
    if (current.estado !== EmpleadoEstado.activo) {
      throw new BadRequestException('El trabajador debe estar activo');
    }

    const activation = this.createActivationToken();
    const employee = await this.prisma.empleado.update({
      where: { id },
      data: {
        activationTokenHash: activation.hash,
        activationTokenExpiresAt: activation.expiresAt,
        activationTokenUsedAt: null,
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
      },
    });

    return this.toResponse(employee, activation.token);
  }

  async findOne(empresaId: bigint, id: bigint) {
    return this.toResponse(await this.ensureEmployeeExists(empresaId, id));
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateEmployeeDto) {
    const current = await this.ensureEmployeeExists(empresaId, id);
    const data = this.normalizeData({
      tipoDocumento: dto.tipoDocumento ?? current.tipoDocumento,
      numeroDocumento: dto.numeroDocumento ?? current.numeroDocumento,
      nombres: dto.nombres ?? current.nombres,
      apellidoPaterno:
        dto.apellidoPaterno !== undefined
          ? dto.apellidoPaterno
          : (current.apellidoPaterno ?? undefined),
      apellidoMaterno:
        dto.apellidoMaterno !== undefined
          ? dto.apellidoMaterno
          : (current.apellidoMaterno ?? undefined),
      email: dto.email ?? current.email,
      telefono: dto.telefono ?? current.telefono,
      turnoId:
        dto.turnoId !== undefined
          ? dto.turnoId
          : (current.turnoId?.toString() ?? null),
      estado: dto.estado ?? current.estado,
    });

    if (data.email !== current.email) {
      await this.assertEmailAvailable(data.email, id);
    }
    await this.assertShiftAvailable(empresaId, data.turnoId);

    try {
      const employee = await this.prisma.$transaction(
        async (tx) => {
          if (
            current.estado !== EmpleadoEstado.activo &&
            data.estado === EmpleadoEstado.activo
          ) {
            await this.plansService.assertResourceLimits(tx, empresaId, {
              attendanceEmployees: 1,
            });
          }
          return tx.empleado.update({
            where: { id },
            data,
            include: {
              turno: {
                select: {
                  id: true,
                  nombre: true,
                  horaEntrada: true,
                  horaSalida: true,
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.toResponse(employee);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateStatus(
    empresaId: bigint,
    id: bigint,
    dto: UpdateEmployeeStatusDto,
  ) {
    const current = await this.ensureEmployeeExists(empresaId, id);

    const employee = await this.prisma.$transaction(
      async (tx) => {
        if (
          current.estado !== EmpleadoEstado.activo &&
          dto.estado === EmpleadoEstado.activo
        ) {
          await this.plansService.assertResourceLimits(tx, empresaId, {
            attendanceEmployees: 1,
          });
        }
        return tx.empleado.update({
          where: { id },
          data: { estado: dto.estado },
          include: {
            turno: {
              select: {
                id: true,
                nombre: true,
                horaEntrada: true,
                horaSalida: true,
              },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toResponse(employee);
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureEmployeeExists(empresaId, id);

    const employee = await this.prisma.empleado.update({
      where: { id },
      data: { estado: EmpleadoEstado.inactivo },
      include: {
        turno: {
          select: {
            id: true,
            nombre: true,
            horaEntrada: true,
            horaSalida: true,
          },
        },
      },
    });

    return this.toResponse(employee);
  }

  async resetDevice(empresaId: bigint, id: bigint) {
    await this.ensureEmployeeExists(empresaId, id);

    const employee = await this.prisma.empleado.update({
      where: { id },
      data: {
        workerDeviceIdHash: null,
        workerDeviceName: null,
        workerDeviceUserAgent: null,
        workerDevicePlatform: null,
        workerDeviceRegisteredAt: null,
        workerDeviceLastSeenAt: null,
        workerDeviceLatitud: null,
        workerDeviceLongitud: null,
        workerDevicePrecisionMetros: null,
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
      },
    });

    return this.toResponse(employee);
  }

  private async ensureEmployeeExists(empresaId: bigint, id: bigint) {
    const employee = await this.prisma.empleado.findFirst({
      where: { id, empresaId },
      include: {
        turno: {
          select: {
            id: true,
            nombre: true,
            horaEntrada: true,
            horaSalida: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Trabajador no encontrado');
    }

    return employee;
  }

  private normalizeData(dto: EmployeeInput): EmployeeData {
    if (!dto.tipoDocumento) {
      throw new BadRequestException('Selecciona un tipo de documento');
    }

    const tipoDocumento = dto.tipoDocumento;
    const numeroDocumento =
      tipoDocumento === EmpleadoTipoDocumento.dni
        ? this.cleanDigits(dto.numeroDocumento)
        : this.cleanRequiredText(dto.numeroDocumento, 'Ingresa el documento');
    const nombres = this.cleanRequiredText(dto.nombres, 'Ingresa los nombres');
    const apellidoPaterno = this.cleanOptionalText(dto.apellidoPaterno);
    const apellidoMaterno = this.cleanOptionalText(dto.apellidoMaterno);
    const email = this.cleanEmail(dto.email);
    const telefono = this.cleanRequiredText(dto.telefono, 'Ingresa el celular');
    const turnoId = this.parseOptionalId(dto.turnoId);
    const estado =
      dto.estado === EmpleadoEstado.inactivo
        ? EmpleadoEstado.inactivo
        : EmpleadoEstado.activo;

    if (tipoDocumento === EmpleadoTipoDocumento.dni) {
      if (!numeroDocumento || !/^\d{8}$/.test(numeroDocumento)) {
        throw new BadRequestException('El DNI debe tener 8 digitos');
      }
    }

    if (
      tipoDocumento !== EmpleadoTipoDocumento.dni &&
      (!numeroDocumento || numeroDocumento.length > 30)
    ) {
      throw new BadRequestException('Documento invalido');
    }

    return {
      tipoDocumento,
      turnoId,
      numeroDocumento,
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      email,
      telefono,
      estado,
    };
  }

  private async assertEmailAvailable(email: string, currentId?: bigint) {
    const [employee, user] = await this.prisma.$transaction([
      this.prisma.empleado.findFirst({
        where: { email, ...(currentId ? { id: { not: currentId } } : {}) },
        select: { id: true },
      }),
      this.prisma.usuario.findUnique({
        where: { email },
        select: { id: true },
      }),
    ]);

    if (employee || user) {
      throw new ConflictException('El correo ya esta registrado en el sistema');
    }
  }

  private async assertShiftAvailable(
    empresaId: bigint,
    turnoId: bigint | null,
  ) {
    if (!turnoId) return;

    const shift = await this.prisma.turno.findFirst({
      where: { id: turnoId, empresaId, estado: TurnoEstado.activo },
      select: { id: true },
    });

    if (!shift) {
      throw new BadRequestException(
        'Selecciona un turno activo de esta empresa',
      );
    }
  }

  private cleanRequiredText(value: string | undefined, message: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    if (!cleanValue) {
      throw new BadRequestException(message);
    }
    return cleanValue;
  }

  private cleanOptionalText(value?: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private cleanDigits(value?: string) {
    return value?.trim().replace(/\D/g, '') || '';
  }

  private parseOptionalId(value?: string | null) {
    if (!value) return null;
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException('Turno invalido');
    }
  }

  private cleanEmail(value?: string) {
    const email = this.cleanRequiredText(
      value,
      'Ingresa el correo',
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Correo invalido');
    }
    return email;
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

  private createActivationToken() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + activationTokenTtlDays);

    return {
      token,
      hash: this.hashToken(token),
      expiresAt,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildActivationUrl(token: string) {
    const baseUrl =
      this.configService.get<string>('WORKER_FRONTEND_URL') ??
      'http://localhost:3002';
    return `${baseUrl.replace(/\/$/, '')}/login?token=${encodeURIComponent(token)}`;
  }

  private getAccessStatus(employee: Empleado) {
    if (employee.activatedAt || employee.pinHash) return 'activado';
    if (
      employee.activationTokenExpiresAt &&
      employee.activationTokenExpiresAt < new Date()
    ) {
      return 'expirado';
    }
    return 'pendiente';
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(',')
        : '';
      if (target.includes('email')) {
        throw new ConflictException(
          'El correo ya esta registrado en el sistema',
        );
      }
      throw new ConflictException('Ya existe un trabajador con ese documento');
    }

    throw error;
  }

  private toResponse(employee: EmployeeWithShift, activationToken?: string) {
    return {
      id: employee.id.toString(),
      empresaId: employee.empresaId.toString(),
      turnoId: employee.turnoId?.toString() ?? null,
      turno: employee.turno
        ? {
            id: employee.turno.id.toString(),
            nombre: employee.turno.nombre,
            horaEntrada: employee.turno.horaEntrada,
            horaSalida: employee.turno.horaSalida,
          }
        : null,
      tipoDocumento: employee.tipoDocumento,
      numeroDocumento: employee.numeroDocumento,
      nombres: employee.nombres,
      apellidoPaterno: employee.apellidoPaterno,
      apellidoMaterno: employee.apellidoMaterno,
      email: employee.email,
      telefono: employee.telefono,
      estado: employee.estado,
      accessStatus: this.getAccessStatus(employee),
      deviceStatus: employee.workerDeviceIdHash
        ? 'registrado'
        : 'sin_dispositivo',
      workerDeviceName: employee.workerDeviceName,
      workerDeviceRegisteredAt:
        employee.workerDeviceRegisteredAt?.toISOString() ?? null,
      activationUrl: activationToken
        ? this.buildActivationUrl(activationToken)
        : null,
      activationTokenExpiresAt:
        employee.activationTokenExpiresAt?.toISOString() ?? null,
      activatedAt: employee.activatedAt?.toISOString() ?? null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
    };
  }
}
