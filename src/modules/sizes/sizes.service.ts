import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSizeDto } from './dto/create-size.dto';
import { FindSizesQueryDto } from './dto/find-sizes-query.dto';
import { UpdateSizeDto } from './dto/update-size.dto';

@Injectable()
export class SizesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(empresaId: bigint, query: FindSizesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.TallaWhereInput = {
      empresaId,
      deletedAt: null,
      sistemaCodigo: null,
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

    const [sizes, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.talla.findMany({
          where,
          orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.talla.count({ where }),
        this.prisma.talla.count({
          where: {
            empresaId,
            deletedAt: null,
            sistemaCodigo: null,
            activo: true,
          },
        }),
        this.prisma.talla.count({
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
      data: sizes.map((size) => this.toResponse(size)),
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

  async create(empresaId: bigint, dto: CreateSizeDto) {
    const nombre = this.cleanName(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const existingSize = await this.prisma.talla.findUnique({
      where: {
        empresaId_nombreKey: {
          empresaId,
          nombreKey,
        },
      },
    });

    if (existingSize && !existingSize.deletedAt) {
      throw new ConflictException('Ya existe una talla con ese nombre');
    }

    if (existingSize?.deletedAt) {
      const restoredSize = await this.prisma.talla.update({
        where: { id: existingSize.id },
        data: {
          nombre,
          activo: dto.activo ?? true,
          deletedAt: null,
        },
      });

      return this.toResponse(restoredSize);
    }

    const size = await this.prisma.talla.create({
      data: {
        empresaId,
        nombre,
        nombreKey,
        activo: dto.activo ?? true,
      },
    });

    return this.toResponse(size);
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateSizeDto) {
    await this.ensureSizeExists(empresaId, id);

    const data: Prisma.TallaUpdateInput = {};

    if (dto.nombre !== undefined) {
      const nombre = this.cleanName(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.activo !== undefined) {
      data.activo = dto.activo;
    }

    try {
      const size = await this.prisma.talla.update({
        where: { id },
        data,
      });

      return this.toResponse(size);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una talla con ese nombre');
      }

      throw error;
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureSizeExists(empresaId, id);

    const size = await this.prisma.talla.update({
      where: { id },
      data: {
        activo: false,
        deletedAt: new Date(),
      },
    });

    return this.toResponse(size);
  }

  private async ensureSizeExists(empresaId: bigint, id: bigint) {
    const size = await this.prisma.talla.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
        sistemaCodigo: null,
      },
      select: { id: true },
    });

    if (!size) {
      throw new NotFoundException('Talla no encontrada');
    }
  }

  private cleanName(name: string) {
    return name.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private buildNameKey(name: string) {
    return this.cleanName(name).toLowerCase();
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

  private toResponse(size: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: size.id.toString(),
      empresaId: size.empresaId.toString(),
      nombre: size.nombre,
      activo: size.activo,
      createdAt: size.createdAt,
      updatedAt: size.updatedAt,
    };
  }
}
