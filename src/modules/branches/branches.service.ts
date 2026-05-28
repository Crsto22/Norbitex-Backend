import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SucursalEstado, SucursalTipo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { FindBranchesQueryDto } from './dto/find-branches-query.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint, query: FindBranchesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.SucursalWhereInput = {
      empresaId,
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
              { ubigeo: { contains: search } },
              { distrito: { contains: search, mode: 'insensitive' } },
              { direccion: { contains: search, mode: 'insensitive' } },
              {
                codigoEstablecimientoSunat: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [branches, total, activeTotal, inactiveTotal, storeTotal, warehouseTotal] =
      await this.prisma.$transaction([
        this.prisma.sucursal.findMany({
          where,
          orderBy: [
            { esPrincipal: 'desc' },
            { estado: 'asc' },
            { nombre: 'asc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.sucursal.count({ where }),
        this.prisma.sucursal.count({
          where: { empresaId, estado: SucursalEstado.activo },
        }),
        this.prisma.sucursal.count({
          where: { empresaId, estado: SucursalEstado.inactivo },
        }),
        this.prisma.sucursal.count({
          where: { empresaId, tipo: SucursalTipo.tienda },
        }),
        this.prisma.sucursal.count({
          where: { empresaId, tipo: SucursalTipo.almacen },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: branches.map((branch) => this.toResponse(branch)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        activeTotal,
        inactiveTotal,
        storeTotal,
        warehouseTotal,
      },
    };
  }

  async create(empresaId: bigint, dto: CreateBranchDto) {
    const nombre = this.cleanText(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const hasBranches = await this.prisma.sucursal.count({ where: { empresaId } });
    const esPrincipal = dto.esPrincipal ?? hasBranches === 0;
    const modoCajaHabilitado = dto.modoCajaHabilitado ?? false;

    this.ensureCashRegisterModeIsAllowed(dto.tipo, modoCajaHabilitado);

    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        if (esPrincipal) {
          await tx.sucursal.updateMany({
            where: { empresaId, esPrincipal: true },
            data: { esPrincipal: false },
          });
        }

        return tx.sucursal.create({
          data: {
            empresaId,
            nombre,
            nombreKey,
            tipo: dto.tipo,
            ubigeo: this.cleanDigits(dto.ubigeo),
            distrito: this.cleanText(dto.distrito),
            direccion: this.cleanText(dto.direccion),
            codigoEstablecimientoSunat: this.cleanOptionalText(
              dto.codigoEstablecimientoSunat,
            ),
            estado: dto.estado ?? SucursalEstado.activo,
            esPrincipal,
            modoCajaHabilitado,
          },
        });
      });

      return this.toResponse(branch);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateBranchDto) {
    const current = await this.ensureBranchExists(empresaId, id);

    const data: Prisma.SucursalUpdateInput = {};
    const nextTipo = dto.tipo ?? current.tipo;
    const nextModoCajaHabilitado =
      dto.modoCajaHabilitado ?? current.modoCajaHabilitado;

    this.ensureCashRegisterModeIsAllowed(nextTipo, nextModoCajaHabilitado);

    if (dto.nombre !== undefined) {
      const nombre = this.cleanText(dto.nombre);
      data.nombre = nombre;
      data.nombreKey = this.buildNameKey(nombre);
    }

    if (dto.tipo !== undefined) {
      data.tipo = dto.tipo;
    }

    if (dto.ubigeo !== undefined) {
      data.ubigeo = this.cleanDigits(dto.ubigeo);
    }

    if (dto.distrito !== undefined) {
      data.distrito = this.cleanText(dto.distrito);
    }

    if (dto.direccion !== undefined) {
      data.direccion = this.cleanText(dto.direccion);
    }

    if (dto.codigoEstablecimientoSunat !== undefined) {
      data.codigoEstablecimientoSunat = this.cleanOptionalText(
        dto.codigoEstablecimientoSunat,
      );
    }

    if (dto.estado !== undefined) {
      data.estado = dto.estado;
    }

    if (dto.esPrincipal !== undefined) {
      data.esPrincipal = dto.esPrincipal;
    }

    if (dto.modoCajaHabilitado !== undefined) {
      data.modoCajaHabilitado = dto.modoCajaHabilitado;
    }

    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        if (dto.esPrincipal === true) {
          await tx.sucursal.updateMany({
            where: {
              empresaId,
              esPrincipal: true,
              id: { not: id },
            },
            data: { esPrincipal: false },
          });
        }

        return tx.sucursal.update({
          where: { id },
          data,
        });
      });

      return this.toResponse(branch);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureBranchExists(empresaId, id);

    const branch = await this.prisma.sucursal.update({
      where: { id },
      data: {
        estado: SucursalEstado.inactivo,
        esPrincipal: false,
      },
    });

    return this.toResponse(branch);
  }

  private async ensureBranchExists(empresaId: bigint, id: bigint) {
    const branch = await this.prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: { id: true, tipo: true, modoCajaHabilitado: true },
    });

    if (!branch) {
      throw new NotFoundException('Sucursal no encontrada');
    }

    return branch;
  }

  private ensureCashRegisterModeIsAllowed(
    tipo: SucursalTipo | 'tienda' | 'almacen',
    modoCajaHabilitado: boolean,
  ) {
    if (tipo === SucursalTipo.almacen && modoCajaHabilitado) {
      throw new BadRequestException(
        'Solo las sucursales tipo tienda pueden habilitar caja',
      );
    }
  }

  private cleanText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private cleanOptionalText(value?: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private cleanDigits(value: string) {
    return value.trim();
  }

  private buildNameKey(name: string) {
    return this.cleanText(name).toLowerCase();
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

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe una sucursal con ese nombre');
    }

    throw error;
  }

  private toResponse(branch: {
    id: bigint;
    empresaId: bigint;
    nombre: string;
    tipo: SucursalTipo;
    ubigeo: string;
    distrito: string;
    direccion: string;
    codigoEstablecimientoSunat: string | null;
    estado: SucursalEstado;
    esPrincipal: boolean;
    modoCajaHabilitado: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: branch.id.toString(),
      empresaId: branch.empresaId.toString(),
      nombre: branch.nombre,
      tipo: branch.tipo,
      ubigeo: branch.ubigeo,
      distrito: branch.distrito,
      direccion: branch.direccion,
      codigoEstablecimientoSunat: branch.codigoEstablecimientoSunat,
      estado: branch.estado,
      esPrincipal: branch.esPrincipal,
      modoCajaHabilitado: branch.modoCajaHabilitado,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    };
  }
}
