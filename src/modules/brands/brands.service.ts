import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { FindBrandsQueryDto } from './dto/find-brands-query.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint, query: FindBrandsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.MarcaWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.status ? { activo: query.status === 'active' } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
            ],
          }
        : {}),
    };

    const [brands, total, activeTotal, inactiveTotal] = await this.prisma.$transaction([
      this.prisma.marca.findMany({
        where,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.marca.count({ where }),
      this.prisma.marca.count({
        where: {
          empresaId,
          deletedAt: null,
          activo: true,
        },
      }),
      this.prisma.marca.count({
        where: {
          empresaId,
          deletedAt: null,
          activo: false,
        },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: brands.map((brand) => this.toResponse(brand)),
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

  async create(empresaId: bigint, dto: CreateBrandDto) {
    const nombre = this.cleanName(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const existingBrand = await this.prisma.marca.findUnique({
      where: {
        empresaId_nombreKey: {
          empresaId,
          nombreKey,
        },
      },
    });

    if (existingBrand && !existingBrand.deletedAt) {
      throw new ConflictException('Ya existe una marca con ese nombre');
    }

    if (existingBrand?.deletedAt) {
      const restoredBrand = await this.prisma.marca.update({
        where: { id: existingBrand.id },
        data: {
          nombre,
          activo: dto.activo ?? true,
          deletedAt: null,
        },
      });

      return this.toResponse(restoredBrand);
    }

    const brand = await this.prisma.marca.create({
      data: {
        empresaId,
        nombre,
        nombreKey,
        activo: dto.activo ?? true,
      },
    });

    return this.toResponse(brand);
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateBrandDto) {
    await this.ensureBrandExists(empresaId, id);

    const data: Prisma.MarcaUpdateInput = {};

    if (dto.nombre !== undefined) {
      const nombre = this.cleanName(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.activo !== undefined) {
      data.activo = dto.activo;
    }

    try {
      const brand = await this.prisma.marca.update({
        where: { id },
        data,
      });

      return this.toResponse(brand);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una marca con ese nombre');
      }

      throw error;
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureBrandExists(empresaId, id);

    const brand = await this.prisma.marca.update({
      where: { id },
      data: {
        activo: false,
        deletedAt: new Date(),
      },
    });

    return this.toResponse(brand);
  }

  private async ensureBrandExists(empresaId: bigint, id: bigint) {
    const brand = await this.prisma.marca.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!brand) {
      throw new NotFoundException('Marca no encontrada');
    }
  }

  private cleanName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private buildNameKey(name: string) {
    return this.cleanName(name).toLowerCase();
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(process.env.PAGINATION_DEFAULT_LIMIT ?? 12);
    const maxLimit = Number(process.env.PAGINATION_MAX_LIMIT ?? 100);

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private toResponse(brand: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: brand.id.toString(),
      empresaId: brand.empresaId.toString(),
      nombre: brand.nombre,
      activo: brand.activo,
      createdAt: brand.createdAt,
      updatedAt: brand.updatedAt,
    };
  }
}
