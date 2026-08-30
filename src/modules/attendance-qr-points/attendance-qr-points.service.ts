import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  PuntoQrAsistencia,
  PuntoQrAsistenciaEstado,
  PuntoQrAsistenciaTipo,
  SucursalEstado,
} from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { CreateAttendanceQrPointDto } from './dto/create-attendance-qr-point.dto';
import { FindAttendanceQrPointsQueryDto } from './dto/find-attendance-qr-points-query.dto';
import { UpdateAttendanceQrPointStatusDto } from './dto/update-attendance-qr-point-status.dto';
import { UpdateAttendanceQrPointDto } from './dto/update-attendance-qr-point.dto';

type QrPointData = {
  sucursalId: bigint;
  nombre: string;
  latitud: number;
  longitud: number;
  precisionMetros: number | null;
  radioMetros: number;
  tipoQr: PuntoQrAsistenciaTipo;
  refreshSeconds: number;
  estado: PuntoQrAsistenciaEstado;
};

type QrPointInput = CreateAttendanceQrPointDto & {
  estado?: 'activo' | 'inactivo';
};

type QrPointWithBranch = PuntoQrAsistencia & {
  sucursal: {
    id: bigint;
    nombre: string;
    tipo: string;
    direccion: string;
    distrito: string;
  };
};

@Injectable()
export class AttendanceQrPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  async findAll(empresaId: bigint, query: FindAttendanceQrPointsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.PuntoQrAsistenciaWhereInput = {
      empresaId,
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              {
                sucursal: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [points, total, activeTotal, inactiveTotal, branchesWithQr] =
      await this.prisma.$transaction([
        this.prisma.puntoQrAsistencia.findMany({
          where,
          include: { sucursal: this.branchSelect() },
          orderBy: [{ estado: 'asc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.puntoQrAsistencia.count({ where }),
        this.prisma.puntoQrAsistencia.count({
          where: { empresaId, estado: PuntoQrAsistenciaEstado.activo },
        }),
        this.prisma.puntoQrAsistencia.count({
          where: { empresaId, estado: PuntoQrAsistenciaEstado.inactivo },
        }),
        this.prisma.puntoQrAsistencia.groupBy({
          by: ['sucursalId'],
          where: { empresaId },
          orderBy: { sucursalId: 'asc' },
        }),
      ]);

    return {
      data: points.map((point) => this.toResponse(point)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        activeTotal,
        inactiveTotal,
        branchesWithQrTotal: branchesWithQr.length,
      },
    };
  }

  async create(empresaId: bigint, dto: CreateAttendanceQrPointDto) {
    const data = this.normalizeData(dto);
    await this.assertActiveBranch(empresaId, data.sucursalId);

    try {
      const point = await this.prisma.$transaction(
        async (tx) => {
          if (data.estado === PuntoQrAsistenciaEstado.activo) {
            await this.plansService.assertResourceLimits(tx, empresaId, {
              attendanceQrPoints: 1,
            });
          }
          return tx.puntoQrAsistencia.create({
            data: {
              empresaId,
              codigo: this.createCode(),
              dynamicSecret: this.createSecret(),
              ...data,
            },
            include: { sucursal: this.branchSelect() },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.toResponse(point);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findOne(empresaId: bigint, id: bigint) {
    return this.toResponse(await this.ensurePointExists(empresaId, id));
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateAttendanceQrPointDto) {
    const current = await this.ensurePointExists(empresaId, id);
    const data = this.normalizeData({
      nombre: dto.nombre ?? current.nombre,
      sucursalId: dto.sucursalId ?? current.sucursalId.toString(),
      latitud: dto.latitud ?? current.latitud,
      longitud: dto.longitud ?? current.longitud,
      precisionMetros:
        dto.precisionMetros !== undefined
          ? dto.precisionMetros
          : current.precisionMetros,
      radioMetros: dto.radioMetros ?? current.radioMetros,
      tipoQr: dto.tipoQr ?? current.tipoQr,
      refreshSeconds: dto.refreshSeconds ?? current.refreshSeconds,
      estado: dto.estado ?? current.estado,
    });
    await this.assertActiveBranch(empresaId, data.sucursalId);

    try {
      const point = await this.prisma.$transaction(
        async (tx) => {
          if (
            current.estado !== PuntoQrAsistenciaEstado.activo &&
            data.estado === PuntoQrAsistenciaEstado.activo
          ) {
            await this.plansService.assertResourceLimits(tx, empresaId, {
              attendanceQrPoints: 1,
            });
          }
          return tx.puntoQrAsistencia.update({
            where: { id },
            data,
            include: { sucursal: this.branchSelect() },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.toResponse(point);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateStatus(
    empresaId: bigint,
    id: bigint,
    dto: UpdateAttendanceQrPointStatusDto,
  ) {
    const current = await this.ensurePointExists(empresaId, id);

    const point = await this.prisma.$transaction(
      async (tx) => {
        if (
          current.estado !== PuntoQrAsistenciaEstado.activo &&
          dto.estado === PuntoQrAsistenciaEstado.activo
        ) {
          await this.plansService.assertResourceLimits(tx, empresaId, {
            attendanceQrPoints: 1,
          });
        }
        return tx.puntoQrAsistencia.update({
          where: { id },
          data: { estado: dto.estado },
          include: { sucursal: this.branchSelect() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toResponse(point);
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensurePointExists(empresaId, id);

    const point = await this.prisma.puntoQrAsistencia.update({
      where: { id },
      data: { estado: PuntoQrAsistenciaEstado.inactivo },
      include: { sucursal: this.branchSelect() },
    });

    return this.toResponse(point);
  }

  async getQr(empresaId: bigint, id: bigint) {
    const point = await this.ensurePointExists(empresaId, id);
    const now = new Date();
    const content =
      point.tipoQr === PuntoQrAsistenciaTipo.dinamico
        ? this.dynamicContent(point, now).content
        : `attendance-qr:${point.codigo}`;
    const dataUrl = await QRCode.toDataURL(content, {
      margin: 2,
      width: 480,
      errorCorrectionLevel: 'M',
    });
    const expiresAt =
      point.tipoQr === PuntoQrAsistenciaTipo.dinamico
        ? this.dynamicContent(point, now).expiresAt
        : null;

    return {
      content,
      dataUrl,
      tipoQr: point.tipoQr,
      refreshSeconds: point.refreshSeconds,
      expiresAt: expiresAt?.toISOString() ?? null,
      serverTime: now.toISOString(),
    };
  }

  private async ensurePointExists(empresaId: bigint, id: bigint) {
    const point = await this.prisma.puntoQrAsistencia.findFirst({
      where: { id, empresaId },
      include: { sucursal: this.branchSelect() },
    });

    if (!point) {
      throw new NotFoundException('Punto QR no encontrado');
    }

    return point;
  }

  private normalizeData(dto: QrPointInput): QrPointData {
    const nombre = dto.nombre?.trim().replace(/\s+/g, ' ');
    if (!nombre) {
      throw new BadRequestException('Ingresa el nombre del punto QR');
    }

    const sucursalId = this.parseId(dto.sucursalId, 'Sucursal invalida');
    const latitud = this.cleanCoordinate(
      dto.latitud,
      -90,
      90,
      'Latitud invalida',
    );
    const longitud = this.cleanCoordinate(
      dto.longitud,
      -180,
      180,
      'Longitud invalida',
    );
    const precisionMetros =
      dto.precisionMetros === null || dto.precisionMetros === undefined
        ? null
        : this.cleanNumber(
            dto.precisionMetros,
            0,
            100_000,
            'Precision invalida',
          );
    const radioMetros = Math.round(
      this.cleanNumber(dto.radioMetros ?? 100, 10, 1000, 'Radio invalido'),
    );
    const tipoQr =
      dto.tipoQr === PuntoQrAsistenciaTipo.dinamico
        ? PuntoQrAsistenciaTipo.dinamico
        : PuntoQrAsistenciaTipo.normal;
    const refreshSeconds = Math.round(
      this.cleanNumber(
        dto.refreshSeconds ?? 20,
        20,
        86_400,
        'Intervalo invalido',
      ),
    );

    return {
      sucursalId,
      nombre,
      latitud,
      longitud,
      precisionMetros,
      radioMetros,
      tipoQr,
      refreshSeconds,
      estado:
        dto.estado === PuntoQrAsistenciaEstado.inactivo
          ? PuntoQrAsistenciaEstado.inactivo
          : PuntoQrAsistenciaEstado.activo,
    };
  }

  private async assertActiveBranch(empresaId: bigint, sucursalId: bigint) {
    const branch = await this.prisma.sucursal.findFirst({
      where: {
        id: sucursalId,
        empresaId,
        estado: SucursalEstado.activo,
      },
      select: { id: true },
    });

    if (!branch) {
      throw new BadRequestException('Selecciona una sucursal activa');
    }
  }

  private parseId(value: string | undefined, message: string) {
    try {
      if (!value) throw new Error(message);
      return BigInt(value);
    } catch {
      throw new BadRequestException(message);
    }
  }

  private cleanCoordinate(
    value: number | undefined,
    min: number,
    max: number,
    message: string,
  ) {
    return this.cleanNumber(value, min, max, message);
  }

  private cleanNumber(
    value: number | undefined,
    min: number,
    max: number,
    message: string,
  ) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(message);
    }
    if (value < min || value > max) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private createCode() {
    return `qrp_${randomUUID().replace(/-/g, '')}`;
  }

  private createSecret() {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  private dynamicContent(point: PuntoQrAsistencia, now: Date) {
    const slot = Math.floor(now.getTime() / 1000 / point.refreshSeconds);
    const signature = this.signDynamic(point.codigo, slot, point.dynamicSecret);
    const expiresAt = new Date((slot + 1) * point.refreshSeconds * 1000);

    return {
      content: `attendance-qr-dynamic:${point.codigo}:${slot}:${signature}`,
      expiresAt,
    };
  }

  private signDynamic(codigo: string, slot: number, secret: string) {
    return createHmac('sha256', secret)
      .update(`${codigo}:${slot}`)
      .digest('hex')
      .slice(0, 24);
  }

  private branchSelect() {
    return {
      select: {
        id: true,
        nombre: true,
        tipo: true,
        direccion: true,
        distrito: true,
      },
    } satisfies Prisma.PuntoQrAsistenciaInclude['sucursal'];
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
      throw new ConflictException('Ya existe un punto QR con ese nombre');
    }

    throw error;
  }

  private toResponse(point: QrPointWithBranch) {
    return {
      id: point.id.toString(),
      empresaId: point.empresaId.toString(),
      sucursalId: point.sucursalId.toString(),
      sucursal: {
        id: point.sucursal.id.toString(),
        nombre: point.sucursal.nombre,
        tipo: point.sucursal.tipo,
        direccion: point.sucursal.direccion,
        distrito: point.sucursal.distrito,
      },
      nombre: point.nombre,
      codigo: point.codigo,
      latitud: point.latitud,
      longitud: point.longitud,
      precisionMetros: point.precisionMetros,
      radioMetros: point.radioMetros,
      tipoQr: point.tipoQr,
      refreshSeconds: point.refreshSeconds,
      estado: point.estado,
      createdAt: point.createdAt.toISOString(),
      updatedAt: point.updatedAt.toISOString(),
    };
  }
}
