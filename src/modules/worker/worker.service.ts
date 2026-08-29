import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EmpleadoEstado,
  MarcajeAsistenciaEstado,
  MarcajeAsistenciaMetodo,
  MarcajeAsistenciaTipo,
  PlanCodigo,
  Prisma,
  PuntoQrAsistenciaEstado,
  PuntoQrAsistenciaTipo,
} from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterWorkerDeviceDto } from './dto/register-worker-device.dto';
import { ScanAttendanceQrDto } from './dto/scan-attendance-qr.dto';

type WorkerEmployee = Prisma.EmpleadoGetPayload<{
  include: {
    empresa: {
      select: {
        id: true;
        nombreComercial: true;
        logoUrl: true;
        planCodigo: true;
        planFinAt: true;
        asistenciasActiva: true;
        asistenciasFinAt: true;
      };
    };
    turno: {
      select: { id: true; nombre: true; horaEntrada: true; horaSalida: true };
    };
  };
}>;

@Injectable()
export class WorkerService {
  constructor(private readonly prisma: PrismaService) {}

  async me(employeeId: bigint, empresaId: bigint) {
    const employee = await this.ensureEmployee(employeeId, empresaId);
    const entries = await this.todayEntries(employee.id, employee.empresaId);

    return {
      trabajador: this.toWorker(employee),
      empresa: {
        id: employee.empresa.id.toString(),
        nombreComercial: employee.empresa.nombreComercial,
        logoUrl: employee.empresa.logoUrl,
      },
      turno: employee.turno
        ? {
            id: employee.turno.id.toString(),
            nombre: employee.turno.nombre,
            horaEntrada: employee.turno.horaEntrada,
            horaSalida: employee.turno.horaSalida,
          }
        : null,
      deviceStatus: this.deviceStatus(employee),
      todayEntries: entries.map((entry) => this.toEntry(entry)),
      todayStatus: this.todayStatus(entries),
    };
  }

  async registerDevice(
    employeeId: bigint,
    empresaId: bigint,
    dto: RegisterWorkerDeviceDto,
  ) {
    const employee = await this.ensureEmployee(employeeId, empresaId);
    const deviceHash = this.hashDevice(dto.deviceId);
    if (
      employee.workerDeviceIdHash &&
      employee.workerDeviceIdHash !== deviceHash
    ) {
      throw new ConflictException(
        'Este trabajador ya tiene un dispositivo registrado',
      );
    }

    const now = new Date();
    const updated = await this.prisma.empleado.update({
      where: { id: employee.id },
      data: {
        workerDeviceIdHash: deviceHash,
        workerDeviceName: this.cleanText(dto.deviceName, 120),
        workerDeviceUserAgent: this.cleanText(dto.userAgent, 500),
        workerDevicePlatform: this.cleanText(dto.platform, 80),
        workerDeviceRegisteredAt: employee.workerDeviceRegisteredAt ?? now,
        workerDeviceLastSeenAt: now,
        workerDeviceLatitud: this.coordinate(
          dto.latitud,
          -90,
          90,
          'Latitud invalida',
        ),
        workerDeviceLongitud: this.coordinate(
          dto.longitud,
          -180,
          180,
          'Longitud invalida',
        ),
        workerDevicePrecisionMetros: this.optionalNumber(dto.precisionMetros),
      },
      include: this.employeeInclude,
    });

    return {
      trabajador: this.toWorker(updated),
      deviceStatus: this.deviceStatus(updated),
    };
  }

  async scan(employeeId: bigint, empresaId: bigint, dto: ScanAttendanceQrDto) {
    const employee = await this.ensureEmployee(employeeId, empresaId);
    this.ensureDevice(employee.workerDeviceIdHash, dto.deviceId);
    const qr = this.parseQr(dto);
    const point = await this.prisma.puntoQrAsistencia.findFirst({
      where: {
        codigo: qr.codigo,
        empresaId,
        estado: PuntoQrAsistenciaEstado.activo,
      },
      include: { sucursal: { select: { id: true, nombre: true } } },
    });

    if (!point) {
      throw new BadRequestException('QR inactivo o no autorizado');
    }
    this.ensureQrIsValid(point, qr);

    const latitud = this.coordinate(dto.latitud, -90, 90, 'Latitud invalida');
    const longitud = this.coordinate(
      dto.longitud,
      -180,
      180,
      'Longitud invalida',
    );
    const distanciaMetros = this.distanceMeters(
      latitud,
      longitud,
      point.latitud,
      point.longitud,
    );

    if (distanciaMetros > point.radioMetros) {
      throw new BadRequestException('Fuera del rango permitido');
    }

    const entries = await this.todayEntries(employee.id, employee.empresaId);
    const hasEntrada = entries.some(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.entrada,
    );
    const hasSalida = entries.some(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.salida,
    );
    if (hasEntrada && hasSalida) {
      throw new ConflictException('La asistencia de hoy ya esta completa');
    }

    const tipo = hasEntrada
      ? MarcajeAsistenciaTipo.salida
      : MarcajeAsistenciaTipo.entrada;
    const entry = await this.prisma.marcajeAsistencia.create({
      data: {
        empresaId: employee.empresaId,
        empleadoId: employee.id,
        turnoId: employee.turnoId,
        sucursalId: point.sucursalId,
        puntoQrId: point.id,
        tipo,
        metodo: MarcajeAsistenciaMetodo.qr,
        estado: MarcajeAsistenciaEstado.valido,
        fechaHora: new Date(),
        latitud,
        longitud,
        precisionMetros: this.optionalNumber(dto.precisionMetros),
        distanciaMetros,
      },
      include: {
        sucursal: { select: { id: true, nombre: true } },
        puntoQr: { select: { id: true, nombre: true } },
      },
    });

    await this.prisma.empleado.update({
      where: { id: employee.id },
      data: { workerDeviceLastSeenAt: new Date() },
    });

    return {
      ...this.toEntry(entry),
      distanciaMetros,
      message:
        tipo === MarcajeAsistenciaTipo.entrada
          ? 'Entrada registrada'
          : 'Salida registrada',
    };
  }

  private async ensureEmployee(employeeId: bigint, empresaId: bigint) {
    const employee = await this.prisma.empleado.findFirst({
      where: {
        id: employeeId,
        empresaId,
        estado: EmpleadoEstado.activo,
        pinHash: { not: null },
      },
      include: this.employeeInclude,
    });

    if (!employee) {
      throw new UnauthorizedException('Sesion de trabajador no valida');
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

  private async todayEntries(employeeId: bigint, empresaId: bigint) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    return this.prisma.marcajeAsistencia.findMany({
      where: {
        empleadoId: employeeId,
        empresaId,
        fechaHora: { gte: start, lte: end },
        estado: { not: MarcajeAsistenciaEstado.anulado },
      },
      include: {
        sucursal: { select: { id: true, nombre: true } },
        puntoQr: { select: { id: true, nombre: true } },
      },
      orderBy: { fechaHora: 'asc' },
    });
  }

  private ensureDevice(storedHash: string | null, deviceId: string) {
    if (!storedHash) {
      throw new BadRequestException('Registra este dispositivo primero');
    }
    if (storedHash !== this.hashDevice(deviceId)) {
      throw new UnauthorizedException('Dispositivo no autorizado');
    }
  }

  private parseQr(dto: ScanAttendanceQrDto) {
    const content = dto.qrContent?.trim();
    const directCode = dto.codigo?.trim();
    if (directCode) return { tipo: 'normal' as const, codigo: directCode };

    if (content?.startsWith('attendance-qr-dynamic:')) {
      const [, codigo, slot, signature] = content.split(':');
      if (!codigo || !slot || !signature || !Number.isInteger(Number(slot))) {
        throw new BadRequestException('QR invalido');
      }
      return {
        tipo: 'dinamico' as const,
        codigo,
        slot: Number(slot),
        signature,
      };
    }

    const code = content?.replace('attendance-qr:', '');
    if (!code || code === content) {
      throw new BadRequestException('QR invalido');
    }
    return { tipo: 'normal' as const, codigo: code };
  }

  private ensureQrIsValid(
    point: {
      codigo: string;
      tipoQr: PuntoQrAsistenciaTipo;
      refreshSeconds: number;
      dynamicSecret: string;
    },
    qr: ReturnType<typeof this.parseQr>,
  ) {
    if (point.tipoQr === PuntoQrAsistenciaTipo.normal) {
      if (qr.tipo !== 'normal') {
        throw new BadRequestException('QR invalido para este punto');
      }
      return;
    }

    if (qr.tipo !== 'dinamico') {
      throw new BadRequestException('Este punto QR es dinamico');
    }

    const currentSlot = Math.floor(Date.now() / 1000 / point.refreshSeconds);
    if (qr.slot !== currentSlot && qr.slot !== currentSlot - 1) {
      throw new BadRequestException('QR expirado');
    }

    const expected = this.signDynamic(
      point.codigo,
      qr.slot,
      point.dynamicSecret,
    );
    if (qr.signature !== expected) {
      throw new BadRequestException('QR invalido');
    }
  }

  private signDynamic(codigo: string, slot: number, secret: string) {
    return createHmac('sha256', secret)
      .update(`${codigo}:${slot}`)
      .digest('hex')
      .slice(0, 24);
  }

  private todayStatus(entries: Array<{ tipo: MarcajeAsistenciaTipo }>) {
    const hasEntrada = entries.some(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.entrada,
    );
    const hasSalida = entries.some(
      (entry) => entry.tipo === MarcajeAsistenciaTipo.salida,
    );
    if (hasEntrada && hasSalida) return 'completo';
    if (hasEntrada) return 'en_jornada';
    return 'pendiente';
  }

  private deviceStatus(employee: WorkerEmployee) {
    return {
      registered: Boolean(employee.workerDeviceIdHash),
      name: employee.workerDeviceName,
      registeredAt: employee.workerDeviceRegisteredAt?.toISOString() ?? null,
      lastSeenAt: employee.workerDeviceLastSeenAt?.toISOString() ?? null,
    };
  }

  private toWorker(employee: WorkerEmployee) {
    return {
      id: employee.id.toString(),
      empresaId: employee.empresaId.toString(),
      numeroDocumento: employee.numeroDocumento,
      nombres: employee.nombres,
      apellidoPaterno: employee.apellidoPaterno,
      apellidoMaterno: employee.apellidoMaterno,
      email: employee.email,
      telefono: employee.telefono,
    };
  }

  private toEntry(entry: {
    id: bigint;
    tipo: MarcajeAsistenciaTipo;
    fechaHora: Date;
    distanciaMetros: number | null;
    sucursal?: { id: bigint; nombre: string } | null;
    puntoQr?: { id: bigint; nombre: string } | null;
  }) {
    return {
      id: entry.id.toString(),
      tipo: entry.tipo,
      fechaHora: entry.fechaHora.toISOString(),
      hora: `${String(entry.fechaHora.getHours()).padStart(2, '0')}:${String(
        entry.fechaHora.getMinutes(),
      ).padStart(2, '0')}`,
      distanciaMetros: entry.distanciaMetros,
      sucursal: entry.sucursal
        ? { id: entry.sucursal.id.toString(), nombre: entry.sucursal.nombre }
        : null,
      puntoQr: entry.puntoQr
        ? { id: entry.puntoQr.id.toString(), nombre: entry.puntoQr.nombre }
        : null,
    };
  }

  private coordinate(value: number, min: number, max: number, message: string) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(message);
    }
    if (value < min || value > max) throw new BadRequestException(message);
    return value;
  }

  private optionalNumber(value?: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private cleanText(value: string | undefined, max: number) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue ? cleanValue.slice(0, max) : null;
  }

  private hashDevice(deviceId: string) {
    return createHash('sha256').update(deviceId).digest('hex');
  }

  private distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const a =
      sinLat ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private get employeeInclude() {
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
        select: { id: true, nombre: true, horaEntrada: true, horaSalida: true },
      },
    } as const;
  }
}
