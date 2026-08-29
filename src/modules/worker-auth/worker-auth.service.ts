import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Empleado, EmpleadoEstado, PlanCodigo } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmActivationDto } from './dto/confirm-activation.dto';
import { ValidateActivationDto } from './dto/validate-activation.dto';
import { WorkerLookupDto } from './dto/worker-lookup.dto';
import { WorkerLoginDto } from './dto/worker-login.dto';

type WorkerEmployee = Empleado & {
  empresa: {
    id: bigint;
    nombreComercial: string;
    logoUrl: string | null;
    planCodigo: PlanCodigo;
    planFinAt: Date | null;
    asistenciasActiva: boolean;
    asistenciasFinAt: Date | null;
  };
  turno?: {
    id: bigint;
    nombre: string;
    horaEntrada: string;
    horaSalida: string;
  } | null;
};

@Injectable()
export class WorkerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateActivation(dto: ValidateActivationDto) {
    return {
      trabajador: this.toWorkerResponse(
        await this.findByActivationToken(dto.token),
      ),
    };
  }

  async confirmActivation(dto: ConfirmActivationDto) {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException('Los PIN no coinciden');
    }

    const employee = await this.findByActivationToken(dto.token);
    this.ensureAttendanceAccess(employee);
    const pinHash = await bcrypt.hash(dto.pin, 12);
    const now = new Date();

    const activated = await this.prisma.empleado.update({
      where: { id: employee.id },
      data: {
        pinHash,
        activatedAt: employee.activatedAt ?? now,
        activationTokenUsedAt: now,
        activationTokenHash: null,
      },
      include: this.workerInclude,
    });

    return this.buildSession(activated);
  }

  async lookup(dto: WorkerLookupDto) {
    const employee = await this.prisma.empleado.findFirst({
      where: {
        numeroDocumento: dto.numeroDocumento.trim(),
        estado: EmpleadoEstado.activo,
        pinHash: { not: null },
      },
      include: this.workerInclude,
    });

    if (!employee) {
      throw new NotFoundException('Trabajador no encontrado');
    }

    return {
      exists: true,
      trabajador: {
        nombres: employee.nombres,
        apellidoPaterno: employee.apellidoPaterno,
        apellidoMaterno: employee.apellidoMaterno,
        numeroDocumento: employee.numeroDocumento,
      },
    };
  }

  async login(dto: WorkerLoginDto) {
    const numeroDocumento = dto.numeroDocumento.trim();
    if (!numeroDocumento) {
      throw new BadRequestException('Ingresa el documento');
    }

    const employees = await this.prisma.empleado.findMany({
      where: {
        numeroDocumento,
        estado: EmpleadoEstado.activo,
        pinHash: { not: null },
      },
      include: this.workerInclude,
      take: 20,
    });

    const matches: WorkerEmployee[] = [];
    for (const employee of employees) {
      if (
        employee.pinHash &&
        (await bcrypt.compare(dto.pin, employee.pinHash))
      ) {
        matches.push(employee);
      }
    }

    if (matches.length === 0) {
      throw new UnauthorizedException('Documento o PIN incorrecto');
    }

    if (matches.length > 1) {
      throw new ConflictException('Acceso ambiguo. Contacta a tu empresa');
    }

    this.ensureAttendanceAccess(matches[0]);

    return this.buildSession(matches[0]);
  }

  private async findByActivationToken(token: string) {
    const tokenHash = this.hashToken(token);
    const employee = await this.prisma.empleado.findFirst({
      where: { activationTokenHash: tokenHash },
      include: this.workerInclude,
    });

    if (!employee) {
      throw new UnauthorizedException('Enlace de activacion invalido');
    }

    if (employee.estado !== EmpleadoEstado.activo) {
      throw new UnauthorizedException('Trabajador inactivo');
    }

    if (
      employee.activationTokenUsedAt ||
      !employee.activationTokenExpiresAt ||
      employee.activationTokenExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Enlace de activacion expirado');
    }

    this.ensureAttendanceAccess(employee);

    return employee;
  }

  private ensureAttendanceAccess(employee: WorkerEmployee) {
    const now = new Date();
    const trialActive =
      employee.empresa.planCodigo === PlanCodigo.prueba &&
      Boolean(employee.empresa.planFinAt) &&
      employee.empresa.planFinAt! > now;
    const subscriptionActive =
      employee.empresa.asistenciasActiva &&
      Boolean(employee.empresa.asistenciasFinAt) &&
      employee.empresa.asistenciasFinAt! >= now;

    if (!trialActive && !subscriptionActive) {
      throw new UnauthorizedException(
        'Cuenta suspendida. La empresa no tiene el servicio de asistencias activo.',
      );
    }
  }

  private buildSession(employee: WorkerEmployee) {
    return {
      accessToken: this.jwtService.sign({
        sub: employee.id.toString(),
        empresaId: employee.empresaId.toString(),
        type: 'worker',
      }),
      trabajador: this.toWorkerResponse(employee),
    };
  }

  private toWorkerResponse(employee: WorkerEmployee) {
    return {
      id: employee.id.toString(),
      empresaId: employee.empresaId.toString(),
      empresa: {
        id: employee.empresa.id.toString(),
        nombreComercial: employee.empresa.nombreComercial,
        logoUrl: employee.empresa.logoUrl,
      },
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
      accessStatus: employee.pinHash ? 'activado' : 'pendiente',
      activatedAt: employee.activatedAt?.toISOString() ?? null,
    };
  }

  private get workerInclude() {
    return {
      empresa: {
        select: {
          id: true,
          nombreComercial: true,
          logoUrl: true,
          planCodigo: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasFinAt: true,
        },
      },
      turno: {
        select: {
          id: true,
          nombre: true,
          horaEntrada: true,
          horaSalida: true,
        },
      },
    } as const;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
