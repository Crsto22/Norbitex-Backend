import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetodoPagoEstado, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseCacheService } from '../../common/cache/response-cache.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { FindPaymentMethodsQueryDto } from './dto/find-payment-methods-query.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: ResponseCacheService,
  ) {}

  async findAll(empresaId: bigint, query: FindPaymentMethodsQueryDto) {
    return this.cache.getOrSet(
      this.cache.key(this.cachePrefix(empresaId), query),
      60_000,
      () => this.findAllUncached(empresaId, query),
    );
  }

  private async findAllUncached(
    empresaId: bigint,
    query: FindPaymentMethodsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.MetodoPagoWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.status
        ? {
            estado:
              query.status === 'active'
                ? MetodoPagoEstado.activo
                : MetodoPagoEstado.inactivo,
          }
        : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
              { descripcion: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [methods, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.metodoPago.findMany({
          where,
          orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.metodoPago.count({ where }),
        this.prisma.metodoPago.count({
          where: {
            empresaId,
            deletedAt: null,
            estado: MetodoPagoEstado.activo,
          },
        }),
        this.prisma.metodoPago.count({
          where: {
            empresaId,
            deletedAt: null,
            estado: MetodoPagoEstado.inactivo,
          },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: methods.map((method) => this.toResponse(method)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        activeTotal,
        inactiveTotal,
      },
    };
  }

  async create(empresaId: bigint, dto: CreatePaymentMethodDto) {
    const nombre = this.cleanName(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const existingMethod = await this.prisma.metodoPago.findUnique({
      where: {
        empresaId_nombreKey: {
          empresaId,
          nombreKey,
        },
      },
    });

    if (existingMethod && !existingMethod.deletedAt) {
      throw new ConflictException('Ya existe un metodo de pago con ese nombre');
    }

    if (existingMethod?.deletedAt) {
      const restoredMethod = await this.prisma.metodoPago.update({
        where: { id: existingMethod.id },
        data: {
          nombre,
          codigo: null,
          descripcion: dto.descripcion ?? null,
          esSistema: false,
          permiteVuelto: false,
          orden: 100,
          estado:
            dto.activo === false
              ? MetodoPagoEstado.inactivo
              : MetodoPagoEstado.activo,
          deletedAt: null,
        },
      });

      this.clearCache(empresaId);
      return this.toResponse(restoredMethod);
    }

    const method = await this.prisma.metodoPago.create({
      data: {
        empresaId,
        nombre,
        nombreKey,
        codigo: null,
        descripcion: dto.descripcion ?? null,
        esSistema: false,
        permiteVuelto: false,
        orden: 100,
        estado:
          dto.activo === false
            ? MetodoPagoEstado.inactivo
            : MetodoPagoEstado.activo,
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(method);
  }

  async update(empresaId: bigint, id: bigint, dto: UpdatePaymentMethodDto) {
    const current = await this.ensureMethodExists(empresaId, id);

    const data: Prisma.MetodoPagoUpdateInput = {};

    if (dto.nombre !== undefined) {
      if (current.esSistema) {
        throw new BadRequestException(
          'Los metodos de pago del sistema no se pueden renombrar',
        );
      }

      const nombre = this.cleanName(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.descripcion !== undefined) {
      data.descripcion = dto.descripcion;
    }

    if (dto.estado !== undefined) {
      data.estado = dto.estado;
    }

    try {
      const method = await this.prisma.metodoPago.update({
        where: { id },
        data,
      });

      this.clearCache(empresaId);
      return this.toResponse(method);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un metodo de pago con ese nombre',
        );
      }

      throw error;
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    const current = await this.ensureMethodExists(empresaId, id);

    if (current.esSistema) {
      throw new BadRequestException(
        'Este metodo de pago es del sistema y no se puede eliminar',
      );
    }

    const method = await this.prisma.metodoPago.update({
      where: { id },
      data: {
        estado: MetodoPagoEstado.inactivo,
        deletedAt: new Date(),
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(method);
  }

  private async ensureMethodExists(empresaId: bigint, id: bigint) {
    const method = await this.prisma.metodoPago.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
      },
      select: { id: true, esSistema: true },
    });

    if (!method) {
      throw new NotFoundException('Metodo de pago no encontrado');
    }

    return method;
  }

  private cleanName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private buildNameKey(name: string) {
    return this.cleanName(name).toLowerCase();
  }

  private cachePrefix(empresaId: bigint) {
    return `catalog:payment-methods:${empresaId.toString()}`;
  }

  private clearCache(empresaId: bigint) {
    this.cache.deletePrefix(this.cachePrefix(empresaId));
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private toResponse(method: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    codigo: string | null;
    descripcion: string | null;
    esSistema: boolean;
    permiteVuelto: boolean;
    orden: number;
    estado: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: method.id.toString(),
      empresaId: method.empresaId.toString(),
      nombre: method.nombre,
      codigo: method.codigo,
      descripcion: method.descripcion,
      esSistema: method.esSistema,
      permiteVuelto: method.permiteVuelto,
      orden: method.orden,
      estado: method.estado,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    };
  }
}
