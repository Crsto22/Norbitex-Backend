import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseCacheService } from '../../common/cache/response-cache.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { FindCategoriesQueryDto } from './dto/find-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: ResponseCacheService,
  ) {}

  async findAll(empresaId: bigint, query: FindCategoriesQueryDto) {
    return this.cache.getOrSet(
      this.cache.key(this.cachePrefix(empresaId), query),
      60_000,
      () => this.findAllUncached(empresaId, query),
    );
  }

  private async findAllUncached(
    empresaId: bigint,
    query: FindCategoriesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.CategoriaWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.status ? { activo: query.status === 'active' } : {}),
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

    const [categories, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.categoria.findMany({
          where,
          orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.categoria.count({ where }),
        this.prisma.categoria.count({
          where: {
            empresaId,
            deletedAt: null,
            activo: true,
          },
        }),
        this.prisma.categoria.count({
          where: {
            empresaId,
            deletedAt: null,
            activo: false,
          },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: categories.map((category) => this.toResponse(category)),
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

  async create(empresaId: bigint, dto: CreateCategoryDto) {
    const nombre = this.cleanName(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const descripcion = this.cleanOptionalText(dto.descripcion);
    const existingCategory = await this.prisma.categoria.findUnique({
      where: {
        empresaId_nombreKey: {
          empresaId,
          nombreKey,
        },
      },
    });

    if (existingCategory && !existingCategory.deletedAt) {
      throw new ConflictException('Ya existe una categoria con ese nombre');
    }

    if (existingCategory?.deletedAt) {
      const restoredCategory = await this.prisma.categoria.update({
        where: { id: existingCategory.id },
        data: {
          nombre,
          descripcion,
          activo: dto.activo ?? true,
          deletedAt: null,
        },
      });

      this.clearCache(empresaId);
      return this.toResponse(restoredCategory);
    }

    const category = await this.prisma.categoria.create({
      data: {
        empresaId,
        nombre,
        nombreKey,
        descripcion,
        activo: dto.activo ?? true,
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(category);
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateCategoryDto) {
    await this.ensureCategoryExists(empresaId, id);

    const data: Prisma.CategoriaUpdateInput = {};

    if (dto.nombre !== undefined) {
      const nombre = this.cleanName(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.descripcion !== undefined) {
      data.descripcion = this.cleanOptionalText(dto.descripcion);
    }

    if (dto.activo !== undefined) {
      data.activo = dto.activo;
    }

    try {
      const category = await this.prisma.categoria.update({
        where: { id },
        data,
      });

      this.clearCache(empresaId);
      return this.toResponse(category);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una categoria con ese nombre');
      }

      throw error;
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureCategoryExists(empresaId, id);

    const category = await this.prisma.categoria.update({
      where: { id },
      data: {
        activo: false,
        deletedAt: new Date(),
      },
    });

    this.clearCache(empresaId);
    return this.toResponse(category);
  }

  private async ensureCategoryExists(empresaId: bigint, id: bigint) {
    const category = await this.prisma.categoria.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Categoria no encontrada');
    }
  }

  private cleanName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private buildNameKey(name: string) {
    return this.cleanName(name).toLowerCase();
  }

  private cleanOptionalText(text?: string) {
    const cleanText = text?.trim().replace(/\s+/g, ' ');
    return cleanText || null;
  }

  private cachePrefix(empresaId: bigint) {
    return `catalog:categories:${empresaId.toString()}`;
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

  private toResponse(category: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    descripcion: string | null;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: category.id.toString(),
      empresaId: category.empresaId.toString(),
      nombre: category.nombre,
      descripcion: category.descripcion,
      activo: category.activo,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
