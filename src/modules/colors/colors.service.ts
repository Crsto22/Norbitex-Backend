import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseCacheService } from '../../common/cache/response-cache.service';
import { CreateColorDto } from './dto/create-color.dto';
import { FindColorsQueryDto } from './dto/find-colors-query.dto';
import { UpdateColorDto } from './dto/update-color.dto';

@Injectable()
export class ColorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: ResponseCacheService,
  ) {}

  async findAll(empresaId: bigint, query: FindColorsQueryDto) {
    return this.cache.getOrSet(
      this.cache.key(this.cachePrefix(empresaId), query),
      60_000,
      () => this.findAllUncached(empresaId, query),
    );
  }

  private async findAllUncached(empresaId: bigint, query: FindColorsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.ColorWhereInput = {
      empresaId,
      deletedAt: null,
      sistemaCodigo: null,
      ...(query.status ? { activo: query.status === 'active' } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
              { hex: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [colors, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.color.findMany({
          where,
          orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.color.count({ where }),
        this.prisma.color.count({
          where: {
            empresaId,
            deletedAt: null,
            sistemaCodigo: null,
            activo: true,
          },
        }),
        this.prisma.color.count({
          where: {
            empresaId,
            deletedAt: null,
            sistemaCodigo: null,
            activo: false,
          },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: colors.map((color) => this.toResponse(color)),
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

  async create(empresaId: bigint, dto: CreateColorDto) {
    const nombre = this.cleanName(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const hex = this.cleanHex(dto.hex);
    const existingColor = await this.prisma.color.findUnique({
      where: {
        empresaId_nombreKey: {
          empresaId,
          nombreKey,
        },
      },
    });

    if (existingColor && !existingColor.deletedAt) {
      throw new ConflictException('Ya existe un color con ese nombre');
    }

    if (existingColor?.deletedAt) {
      const restoredColor = await this.prisma.color.update({
        where: { id: existingColor.id },
        data: {
          nombre,
          hex,
          activo: dto.activo ?? true,
          deletedAt: null,
        },
      });

      this.clearCache(empresaId);
      return this.toResponse(restoredColor);
    }

    const color = await this.prisma.color.create({
      data: {
        empresaId,
        nombre,
        nombreKey,
        hex,
        activo: dto.activo ?? true,
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(color);
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateColorDto) {
    await this.ensureColorExists(empresaId, id);

    const data: Prisma.ColorUpdateInput = {};

    if (dto.nombre !== undefined) {
      const nombre = this.cleanName(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.hex !== undefined) {
      data.hex = this.cleanHex(dto.hex);
    }

    if (dto.activo !== undefined) {
      data.activo = dto.activo;
    }

    try {
      const color = await this.prisma.color.update({
        where: { id },
        data,
      });

      this.clearCache(empresaId);
      return this.toResponse(color);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un color con ese nombre');
      }

      throw error;
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureColorExists(empresaId, id);

    const color = await this.prisma.color.update({
      where: { id },
      data: {
        activo: false,
        deletedAt: new Date(),
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(color);
  }

  private async ensureColorExists(empresaId: bigint, id: bigint) {
    const color = await this.prisma.color.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
        sistemaCodigo: null,
      },
      select: { id: true },
    });

    if (!color) {
      throw new NotFoundException('Color no encontrado');
    }
  }

  private cleanName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private cachePrefix(empresaId: bigint) {
    return `catalog:colors:${empresaId.toString()}`;
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

  private buildNameKey(name: string) {
    return this.cleanName(name).toLowerCase();
  }

  private cleanHex(hex: string) {
    return hex.trim().toUpperCase();
  }

  private toResponse(color: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    hex: string;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: color.id.toString(),
      empresaId: color.empresaId.toString(),
      nombre: color.nombre,
      hex: color.hex,
      activo: color.activo,
      createdAt: color.createdAt,
      updatedAt: color.updatedAt,
    };
  }
}
